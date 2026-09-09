/**
 * A minimal log-scale line chart, drawn as inline SVG.
 *
 * Deliberately plain: axes, one or two curves, and optional measured points.
 * Every chart carries `role="img"` with a text alternative, and the same
 * numbers are available as a table underneath, because a curve is not an
 * accessible way to state a fact on its own.
 *
 * Colours come from the palette tokens rather than `currentColor` with an
 * `opacity`: dimming SVG text with opacity is exactly the pattern the
 * contrast rules forbid (muted text lowers LIGHTNESS, never alpha), and the
 * gate's arithmetic walk measures the composited result either way.
 *
 * Three defects in the accessibility of these charts were fixed here:
 *
 *  - WCAG 1.4.1. Curves were separated by stroke colour alone. On the
 *    against-N chart that meant three DASHED curves — quadratic sieve, number
 *    field sieve, Shor — drawn with one dash pattern and three hues, so under
 *    any colour vision deficiency, in greyscale, or in forced-colours mode
 *    (where `stroke` is replaced wholesale) they collapsed into one another.
 *    Each modelled series now gets its own dash pattern, and a legend inside
 *    the picture names the pattern, so the mapping from mark to method is
 *    visible rather than only stated in the prose beside the chart.
 *
 *  - WCAG 1.1.1. `aria-label` carried a shape sentence and no quantities, and
 *    the numbers disclosure that holds the quantities was not associated with
 *    the chart at all. The label now ends with the endpoints of every series,
 *    and `aria-details` points at the disclosure.
 *
 *  - The disclosure did not contain the data it claims to. Its sampler dropped
 *    the LAST point of every series it thinned — the right-hand end, which on a
 *    cost curve is the entire argument — and `formatOps` rounded every value to
 *    a bare decade, so the sieve and Shor could read as the same number at the
 *    same x. Both fixed below.
 */

import { el, table } from './dom';

export interface Series {
  label: string;
  color: string;
  /** Dashed lines mark a MODEL; solid lines mark measured data. */
  dashed?: boolean;
  points: { x: number; y: number }[];
}

export interface ChartOptions {
  xLabel: string;
  yLabel: string;
  /** Sentence read by a screen reader in place of the picture. */
  description: string;
  width?: number;
  height?: number;
}

const NS = 'http://www.w3.org/2000/svg';

/**
 * Dash patterns for the modelled series of one chart, handed out in order.
 * This is the carrier that survives greyscale and forced colours, so it has to
 * be the pattern that differs, not the length of the line.
 */
const MODEL_DASHES = ['5 3', '1.5 3', '9 4 2 4', '12 3 1.5 3'];

/**
 * Legend geometry, in viewBox units.
 *
 * An SVG with a viewBox scales its text with the box, so a font-size fixed in
 * viewBox units renders at a DIFFERENT CSS size on every chart. At 640 units
 * wide inside a card that is about 300px, `font-size: 9` lands at roughly 4.5
 * CSS px -- unreadable. So the legend's type size is expressed relative to the
 * viewBox width, which keeps it at a constant apparent size whatever the chart.
 */
const LEGEND_ROW_AT_320 = 13;

/**
 * Charts and their numbers disclosure are built by two separate exported calls,
 * and the caller (`ladder.ts`) hands the SAME series array to both. Keying off
 * that array is what lets `chartTable` find the chart it belongs to and wire
 * `aria-details` to it, without chart.ts inventing ids the caller would have to
 * thread through. A chart that never gets a table — the against-N chart is one
 * — simply never gets the attribute, which is the point: a dangling
 * `aria-details` is worse than none, and axe reports it as one.
 */
const chartsBySeries = new WeakMap<Series[], SVGElement>();
let disclosureSeq = 0;

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function logChart(series: Series[], opts: ChartOptions): SVGElement {
  const W = opts.width ?? 320;
  // The legend is added ABOVE the plot rather than inside it: squeezing the
  // plot instead would cost a decade of gridlines on the short cards.
  // Scale every legend measurement with the viewBox so the rendered size is
  // constant across the narrow per-driver charts and the wide against-N one.
  const scale = (opts.width ?? 320) / 320;
  const LEGEND_ROW = LEGEND_ROW_AT_320 * scale;
  const legendFont = 9 * scale;
  const axisFont = 9 * scale;
  const legendH = series.length * LEGEND_ROW;
  const H = (opts.height ?? 170) + legendH;
  const padL = 40;
  const padB = 30;
  const padT = 8 * scale + legendH;
  const padR = 8;

  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => Math.max(p.y, 1e-9));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.log10(Math.min(...ys));
  const yMax = Math.log10(Math.max(...ys));
  const ySpan = yMax - yMin || 1;

  const sx = (x: number): number => padL + ((x - xMin) / (xMax - xMin || 1)) * (W - padL - padR);
  const sy = (y: number): number =>
    H - padB - ((Math.log10(Math.max(y, 1e-9)) - yMin) / ySpan) * (H - padT - padB);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label': describe(series, opts),
    preserveAspectRatio: 'xMidYMid meet',
  });

  // axes
  svg.append(
    svgEl('line', {
      x1: String(padL), y1: String(padT), x2: String(padL), y2: String(H - padB),
      stroke: 'var(--control-border)', 'stroke-width': '1',
    }),
    svgEl('line', {
      x1: String(padL), y1: String(H - padB), x2: String(W - padR), y2: String(H - padB),
      stroke: 'var(--control-border)', 'stroke-width': '1',
    })
  );

  // decade gridlines
  for (let d = Math.ceil(yMin); d <= Math.floor(yMax); d++) {
    const y = sy(10 ** d);
    svg.append(
      svgEl('line', {
        x1: String(padL), y1: String(y), x2: String(W - padR), y2: String(y),
        stroke: 'var(--border)', 'stroke-width': '1',
      })
    );
    const label = svgEl('text', {
      x: String(padL - 5), y: String(y + 3.5), 'text-anchor': 'end',
      'font-size': String(axisFont), fill: 'var(--text-dim)',
    });
    label.textContent = d === 0 ? '1' : `1e${d}`;
    svg.append(label);
  }

  let modelIndex = 0;
  series.forEach((s, i) => {
    const dash = s.dashed ? MODEL_DASHES[modelIndex++ % MODEL_DASHES.length] : '0';
    const d = s.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    svg.append(
      svgEl('path', {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': s.dashed ? '1.6' : '2.2',
        'stroke-dasharray': dash,
        'stroke-linejoin': 'round',
      })
    );
    if (!s.dashed) {
      for (const p of s.points) {
        svg.append(svgEl('circle', { cx: String(sx(p.x)), cy: String(sy(p.y)), r: '3', fill: s.color }));
      }
    }

    // Legend row: the same stroke width and the same dash pattern as the curve
    // it stands for, so the mark is matched by shape and not by hue. The label
    // is --text-dim, the token the axis labels already use at this size, rather
    // than the series colour — a legend that reads in one theme and not the
    // other is not a legend.
    const rowY = 8 * scale + i * LEGEND_ROW + 5 * scale;
    svg.append(
      svgEl('line', {
        x1: String(padL), y1: String(rowY), x2: String(padL + 18), y2: String(rowY),
        stroke: s.color,
        'stroke-width': s.dashed ? '1.6' : '2.2',
        'stroke-dasharray': dash,
      })
    );
    if (!s.dashed) {
      svg.append(svgEl('circle', { cx: String(padL + 9), cy: String(rowY), r: '3', fill: s.color }));
    }
    const key = svgEl('text', {
      x: String(padL + 24 * scale), y: String(rowY + 3.2 * scale),
      'font-size': String(legendFont), fill: 'var(--text-dim)',
    });
    key.textContent = s.label;
    svg.append(key);
  });

  const xText = svgEl('text', {
    x: String((padL + W - padR) / 2), y: String(H - 6), 'text-anchor': 'middle',
    'font-size': String(10 * scale), fill: 'var(--text-dim)',
  });
  xText.textContent = opts.xLabel;
  svg.append(xText);

  const yText = svgEl('text', {
    x: '9', y: String((padT + H - padB) / 2), 'text-anchor': 'middle',
    'font-size': String(10 * scale), fill: 'var(--text-dim)',
    transform: `rotate(-90 9 ${(padT + H - padB) / 2})`,
  });
  yText.textContent = opts.yLabel;
  svg.append(yText);

  chartsBySeries.set(series, svg);
  return svg;
}

/**
 * The text alternative.
 *
 * A shape sentence on its own — "climbs steeply and off the top of the chart" —
 * is a description of a picture, not of the data in it, and it is the whole of
 * what a screen reader got. The endpoints of each series are appended so the
 * quantities that make the comparison are in the alternative itself, and the
 * log axis is stated because a reader who is told "operations 1e12 at 512 bits,
 * 1e26 at 2048" and pictures a linear axis has the wrong picture.
 */
function describe(series: Series[], opts: ChartOptions): string {
  const conventions: string[] = [];
  if (series.some((s) => s.dashed)) conventions.push('modelled series are dashed, each with its own pattern');
  if (series.some((s) => !s.dashed)) conventions.push('series measured in this browser are solid, with a dot at each measurement');
  const legend = conventions.length > 0 ? ` Every curve is named in the legend; ${conventions.join(', and ')}.` : '';

  const trend = series
    .map((s) => {
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      if (!first || !last) return '';
      // A measured series is a single point today, so state it as one rather
      // than as a range from itself to itself.
      if (s.points.length === 1) {
        return `${s.label}: one point, ${opts.yLabel} ${formatOps(first.y)} at ${opts.xLabel} ${first.x}.`;
      }
      return (
        `${s.label}: from ${opts.yLabel} ${formatOps(first.y)} at ${opts.xLabel} ${first.x} ` +
        `to ${formatOps(last.y)} at ${opts.xLabel} ${last.x}.`
      );
    })
    .filter(Boolean)
    .join(' ');
  return `${opts.description} The ${opts.yLabel} axis is logarithmic.${legend} ${trend}`;
}

/**
 * Thin a series for display, keeping BOTH ends.
 *
 * The sampler this replaces was `i % floor(len / 8) === 0`, which keeps a point
 * every stride from the left and therefore drops the last one unless the length
 * happens to divide. On a cost curve the last point is the argument: dropping it
 * left the text alternative describing the flat part of a graph whose only
 * interesting feature is the far end.
 */
function sample<T>(points: T[], max = 9): T[] {
  if (points.length <= max) return points.slice();
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]);
  }
  return out;
}

/** The same numbers as text, so the chart is never the only place they exist. */
export function chartTable(series: Series[], xLabel: string, yLabel: string): HTMLElement {
  const d = el('details');
  d.append(el('summary', { text: 'The numbers behind this chart' }));
  for (const s of series) {
    d.append(el('p', { class: 'small', text: `${s.label} — ${s.dashed ? 'modelled' : 'measured here'}` }));
    // A real table, with a header cell per column. This was a paragraph of
    // semicolon-separated pairs, which is the data but not in a shape any
    // screen reader can navigate a row at a time — and `chartTable` was not
    // telling the truth about what it built.
    d.append(
      table(
        [xLabel, yLabel],
        sample(s.points).map((p) => [String(p.x), formatOps(p.y)]),
        `${s.label}: ${yLabel} against ${xLabel}`
      )
    );
  }

  // Associate the disclosure with its chart. `aria-details` rather than
  // `aria-describedby`: a description is flattened into one string, and
  // flattening two nine-row tables into the chart's description would bury the
  // label under the data every time focus reached it. `aria-details` points at
  // structured content the reader can navigate into instead, which is what this
  // is. The enriched `aria-label` above is what carries the numbers for the
  // readers whose software does not follow `aria-details` yet.
  const chart = chartsBySeries.get(series);
  if (chart) {
    const id = `chart-numbers-${++disclosureSeq}`;
    d.id = id;
    chart.setAttribute('aria-details', id);
  }
  return d;
}

/**
 * Format an operation count.
 *
 * One mantissa digit is kept. The bare-decade form this replaces printed both
 * the quadratic sieve and the number field sieve at 512 bits as the same string
 * when they differ by a factor of several, so the table that exists to carry the
 * comparison for non-visual readers stated no comparison at all.
 */
export function formatOps(v: number): string {
  // Worded, not an em dash: this string is interpolated into the chart's
  // aria-label, where a bare "—" is announced as a stray dash with no meaning.
  if (!Number.isFinite(v)) return 'not a number';
  if (v < 1000) return v.toFixed(v < 10 ? 1 : 0);
  let exp = Math.floor(Math.log10(v));
  let mantissa = v / 10 ** exp;
  // 9.97 rounds to 10.0 at one decimal place, which is 1e(exp+1), not 10e(exp).
  if (Number(mantissa.toFixed(1)) >= 10) {
    mantissa /= 10;
    exp += 1;
  }
  return `${mantissa.toFixed(1).replace(/\.0$/, '')}e${exp}`;
}
