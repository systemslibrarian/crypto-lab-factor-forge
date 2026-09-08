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
 */

import { el } from './dom';

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

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function logChart(series: Series[], opts: ChartOptions): SVGElement {
  const W = opts.width ?? 320;
  const H = opts.height ?? 170;
  const padL = 40;
  const padB = 30;
  const padT = 10;
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
    role: 'img',
    'aria-label': opts.description,
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
      'font-size': '9', fill: 'var(--text-dim)',
    });
    label.textContent = d === 0 ? '1' : `1e${d}`;
    svg.append(label);
  }

  for (const s of series) {
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    svg.append(
      svgEl('path', {
        d,
        fill: 'none',
        stroke: s.color,
        'stroke-width': s.dashed ? '1.6' : '2.2',
        'stroke-dasharray': s.dashed ? '5 3' : '0',
        'stroke-linejoin': 'round',
      })
    );
    if (!s.dashed) {
      for (const p of s.points) {
        svg.append(svgEl('circle', { cx: String(sx(p.x)), cy: String(sy(p.y)), r: '3', fill: s.color }));
      }
    }
  }

  const xText = svgEl('text', {
    x: String((padL + W - padR) / 2), y: String(H - 6), 'text-anchor': 'middle',
    'font-size': '10', fill: 'var(--text-dim)',
  });
  xText.textContent = opts.xLabel;
  svg.append(xText);

  const yText = svgEl('text', {
    x: '9', y: String((padT + H - padB) / 2), 'text-anchor': 'middle',
    'font-size': '10', fill: 'var(--text-dim)',
    transform: `rotate(-90 9 ${(padT + H - padB) / 2})`,
  });
  yText.textContent = opts.yLabel;
  svg.append(yText);

  return svg;
}

/** The same numbers as text, so the chart is never the only place they exist. */
export function chartTable(series: Series[], xLabel: string, yLabel: string): HTMLElement {
  const d = el('details');
  d.append(el('summary', { text: 'The numbers behind this chart' }));
  for (const s of series) {
    d.append(el('p', { class: 'small', text: `${s.label} — ${s.dashed ? 'modelled' : 'measured here'}` }));
    const line = s.points
      .filter((_, i) => i % Math.max(1, Math.floor(s.points.length / 8)) === 0)
      .map((p) => `${xLabel} ${p.x}: ${yLabel} ${formatOps(p.y)}`)
      .join('; ');
    d.append(el('p', { class: 'small muted', text: line }));
  }
  return d;
}

export function formatOps(v: number): string {
  if (v < 1000) return v.toFixed(v < 10 ? 1 : 0);
  const exp = Math.floor(Math.log10(v));
  return `1e${exp}`;
}
