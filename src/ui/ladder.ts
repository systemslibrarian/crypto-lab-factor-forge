/**
 * "The Ladder" — cost as a function of what each method actually depends on.
 *
 * The visual rule this panel exists to obey: NEVER draw all seven curves
 * against the size of N. That picture is the exact misconception the lab is
 * here to remove — rho and ECM do not care how big N is, and Fermat cares
 * about |p - q| and nothing else. So each method gets its own axis, labelled
 * with its own driver, and only the three methods that genuinely depend on N
 * share the last chart.
 */

import { ALGORITHMS, type AlgorithmId } from '../factor/types';
import { chartTable, formatOps, logChart, type Series } from './chart';
import { clear, el, table } from './dom';
import { completedRuns, type RunRecord } from './state';

const ACCENT = 'var(--accent)';
const MEASURED = 'var(--ok-text)';

/** Modelled operation counts. Each is the standard heuristic for that method. */
/**
 * One entry per method: the driver it is plotted against, the unit BOTH the
 * model and the measurement are expressed in, the model itself, and how to read
 * a real measurement out of a completed run.
 *
 * `yLabel` is load-bearing. The measured dots and the modelled curve share an
 * axis, so they have to share a unit — and they did not. The `smoothness`
 * branch used to plot `bound * log2(bound)`, which is the MODEL evaluated at the
 * number the user typed into the parameter box: a parameter drawn as if it were
 * a measurement, on a panel whose legend says "measured in this browser". ECM
 * fell into the same branch, so its dot was the bits of the largest prime of a
 * curve order, plotted against an axis labelled "bits of the smallest factor" —
 * a different quantity entirely.
 *
 * Every `measure` below now reads a counter the algorithm actually incremented.
 */
interface LadderModel {
  xLabel: string;
  /** The unit shared by the model curve and the measured dot. */
  yLabel: string;
  xs: number[];
  f: (x: number) => number;
  note: string;
  /** A real measurement in `yLabel` units, or null when there is none. */
  measure: (rec: RunRecord) => { x: number; y: number } | null;
}

/** Read a metric the algorithm counted, stripping the display formatting. */
function metric(rec: RunRecord, key: string): number | null {
  const m = rec.outcome.trace.metrics.find((x) => x.key === key);
  if (!m) return null;
  const v = Number(m.value.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
}

function point(x: number | null, y: number | null): { x: number; y: number } | null {
  return x === null || y === null || y <= 0 ? null : { x, y: Math.max(1, y) };
}

const MODELS: Record<AlgorithmId, LadderModel> = {
  trial: {
    xLabel: 'bits of the SMALLEST factor',
    yLabel: 'trial divisions',
    xs: range(8, 44, 2),
    f: (bits) => {
      const p = 2 ** bits;
      return p / Math.log(p);
    },
    note: 'One division per prime below the factor: linear in the factor itself, so every extra bit doubles the work.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'small-factor') return null;
      return point(bitsOf(why.factor), metric(rec, 'divisions'));
    },
  },
  fermat: {
    xLabel: 'bits of |p - q|',
    yLabel: 'a-steps',
    xs: range(1, 40, 2),
    f: (bits) => Math.max(1, 2 ** (2 * bits) / (8 * 2 ** 30)),
    note: 'Steps go as (p - q)² / (8·sqrt(N)); the curve is drawn for a 60-bit N, so a measured dot from a different size will not sit on it.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'p-q-gap') return null;
      return point(why.gapBits, why.steps);
    },
  },
  rho: {
    xLabel: 'bits of the SMALLEST factor',
    yLabel: 'iterations of f',
    xs: range(8, 80, 4),
    f: (bits) => 1.18 * Math.sqrt(2 ** bits),
    note: 'Birthday bound: about 1.18·sqrt(p) iterations. The size of N does not appear.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'smallest-factor') return null;
      return point(why.factorBits, why.steps);
    },
  },
  pminus1: {
    xLabel: 'bits of the largest prime factor of p - 1',
    yLabel: 'prime powers processed',
    xs: range(4, 30, 2),
    f: (bits) => {
      // To catch a b-bit prime the bound must reach 2^b, and stage 1 processes
      // one prime power per prime below the bound: pi(2^b).
      const B = 2 ** bits;
      return B / Math.log(B);
    },
    note: 'The bound B must reach the largest prime of p - 1, and stage 1 costs one modular exponentiation per prime below B. A safe prime puts a prime of size p/2 there, which no affordable B reaches.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'smoothness' || !why.complete) return null;
      return point(bitsOf(why.largestPrime), metric(rec, 'stage-1 primes'));
    },
  },
  pplus1: {
    xLabel: 'bits of the largest prime factor of p + 1 (or p - 1, whichever group caught it)',
    yLabel: 'Lucas ladder steps',
    xs: range(4, 30, 2),
    f: (bits) => {
      const B = 2 ** bits;
      return B / Math.log(B);
    },
    note: 'Same shape as p-1, in the group of order p + 1 — when the base lands there. A safe prime does NOT protect this side: p + 1 = 2(q + 1) is arbitrary.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'smoothness' || !why.complete) return null;
      return point(bitsOf(why.largestPrime), metric(rec, 'Lucas ladders'));
    },
  },
  ecm: {
    xLabel: 'bits of the SMALLEST factor',
    yLabel: 'curves drawn',
    xs: range(16, 96, 4),
    f: (bits) => {
      // Expected curves is 1/rho(u) for u = ln p / ln B1, with Dickman's rho
      // approximated crudely as u^-u. Drawn at the default B1 = 20,000.
      const u = (bits * Math.LN2) / Math.log(20_000);
      return Math.max(1, u ** u);
    },
    note: 'Each curve is one draw for a smooth group order, so the cost is a COUNT OF CURVES. The curve here is 1/ρ(u) with Dickman’s ρ crudely approximated by u^−u at B1 = 20,000 — an order-of-magnitude guide, not a prediction.',
    measure: (rec) => point(metric(rec, 'factor bits'), metric(rec, 'curves tried')),
  },
  qs: {
    xLabel: 'bits of N',
    yLabel: 'relation-sieve operations',
    xs: range(40, 400, 10),
    f: (bits) => {
      const lnN = bits * Math.LN2;
      return Math.exp(Math.sqrt(lnN * Math.log(lnN)));
    },
    note: 'L_N[1/2, 1]. No property of p or q appears anywhere in it — which is exactly why bigger primes are the only defence.',
    measure: (rec) => {
      const why = rec.outcome.trace.why;
      if (!why || why.kind !== 'relations') return null;
      // Sieving cost is dominated by relations x factor-base size, both counted.
      return point(rec.ctx.n.toString(2).length, why.relations * why.factorBaseSize);
    },
  },
};

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let x = a; x <= b; x += step) out.push(x);
  return out;
}

/** Measured points from this session's runs, plotted on the method's own axis. */
function measuredFor(id: AlgorithmId): { x: number; y: number }[] {
  const rec = completedRuns().get(id);
  if (!rec || !rec.outcome.trace.why) return [];
  const p = MODELS[id].measure(rec);
  return p ? [p] : [];
}

function bitsOf(decimal: string): number {
  return BigInt(decimal).toString(2).length;
}

export function mountLadderPanel(root: HTMLElement): () => void {
  const render = (): void => {
    clear(root);
    root.append(
      el(
        'div',
        { class: 'intro' },
        el('h2', { text: 'Every method on the axis it actually depends on' }),
        el('p', {
          text:
            'Plotting every factoring algorithm against "the size of N" is the single most misleading picture in this subject. Only three of the methods here depend on N at all. The rest are driven by a property of p — and each chart below is labelled with the one it is actually driven by.',
        }),
        el('p', {
          class: 'small muted',
          id: 'ladder-legend',
          text: `Dashed lines are the standard cost model for the method. Solid dots are measurements taken in this browser during your runs on the "Factor N" tab, plotted on the same axis and in the same unit — a model and a measurement never share an axis here unless they share a unit. ${ALGORITHMS.length} methods, ${new Set(ALGORITHMS.map((a) => MODELS[a.id].xLabel)).size} distinct drivers.`,
        })
      )
    );

    const grid = el('div', { class: 'ladder-grid' });
    for (const meta of ALGORITHMS) {
      const model = MODELS[meta.id];
      const series: Series[] = [
        {
          label: `${meta.name} (model)`,
          color: ACCENT,
          dashed: true,
          points: model.xs.map((x) => ({ x, y: model.f(x) })),
        },
      ];
      const measured = measuredFor(meta.id);
      if (measured.length > 0) {
        series.push({ label: `${meta.name} (measured here)`, color: MEASURED, points: measured });
      }

      const card = el('div', { class: 'ladder-card' });
      card.append(el('h3', { text: meta.name }));
      card.append(
        el('p', { class: 'ladder-axis', text: `${model.yLabel} vs ${model.xLabel}` })
      );
      card.append(
        logChart(series, {
          xLabel: model.xLabel,
          yLabel: model.yLabel,
          description: `${meta.name}: modelled cost, in ${model.yLabel}, rising with ${model.xLabel}. ${model.note}`,
        })
      );
      card.append(el('p', { class: 'ladder-note', text: model.note }));
      if (measured.length > 0) {
        card.append(
          el('p', {
            class: 'ladder-note',
            text: `Measured here: ${measured.map((p) => `${p.x} → ${p.y.toLocaleString()} ${model.yLabel}`).join(', ')}.`,
          })
        );
      }
      card.append(chartTable(series, model.xLabel, model.yLabel));
      grid.append(card);
    }
    root.append(grid);

    // ── The methods that really do scale with N, plus Shor ────────────────
    const nCard = el('div', { class: 'card' });
    nCard.append(el('h2', { text: 'The only fair "against N" chart' }));
    const bitsAxis = range(64, 2048, 64);
    const nSeries: Series[] = [
      {
        label: 'Quadratic sieve — L_N[1/2, 1]',
        color: ACCENT,
        dashed: true,
        points: bitsAxis.map((b) => ({ x: b, y: lHalf(b) })),
      },
      {
        label: 'Number field sieve — L_N[1/3, 1.923]',
        color: 'var(--alarm-text)',
        dashed: true,
        points: bitsAxis.map((b) => ({ x: b, y: lThird(b) })),
      },
      {
        label: "Shor's algorithm — polynomial",
        color: 'var(--ok-text)',
        dashed: true,
        points: bitsAxis.map((b) => ({ x: b, y: b ** 3 })),
      },
    ];
    // The count and the inventory are DERIVED from the series, never written
    // out. This paragraph read "These four" beside a chart carrying three --
    // exactly the drift a hand-written count invites, and the reason the
    // claims suite now asserts the two agree.
    const names = nSeries.map((x) => x.label.split('—')[0].trim());
    nCard.append(
      el('p', {
        class: 'small',
        id: 'against-n-count',
        text: `These ${names.length} are the methods whose cost genuinely is a function of the size of N and nothing else: ${names.join(', ')}. Note the axis: bits of N, running well past anything this page can factor, because the interesting part of the comparison only starts there.`,
      })
    );
    nCard.append(
      logChart(nSeries, {
        xLabel: 'bits of N',
        yLabel: 'operations',
        description: `${names.length} cost curves against the size of N (${names.join(', ')}): the quadratic sieve and the number field sieve both climb steeply and off the top of the chart, while Shor stays a shallow cubic line near the bottom.`,
        width: 640,
        height: 260,
      })
    );
    // The against-N chart gets the same numbers-disclosure association the seven
    // per-driver charts have. Without it, it was the one chart whose data lived
    // only in a hand-built table beside it that nothing linked to the picture.
    nCard.append(chartTable(nSeries, 'bits of N', 'operations'));
    nCard.append(
      table(
        ['Bits of N', 'Quadratic sieve', 'Number field sieve', "Shor (cubic)"],
        [512, 1024, 2048].map((b) => [
          String(b),
          formatOps(lHalf(b)),
          formatOps(lThird(b)),
          formatOps(b ** 3),
        ]),
        'Cost against the size of N'
      )
    );
    nCard.append(
      el('p', {
        class: 'small muted',
        text:
          'These are operation counts from the standard asymptotic formulas, not timings, and the constants are ignored. They are here to show the SHAPE of the gap, which is the part that survives every constant.',
      })
    );
    root.append(nCard);

    root.append(
      el(
        'div',
        { class: 'note' },
        el('strong', { text: 'Read the axes before the curves. ' }),
        document.createTextNode(
          'A chart with all seven methods on one "bits of N" axis would put rho and ECM on a curve that has nothing to do with what they do. That picture is common and it is wrong.'
        )
      )
    );
  };

  render();
  return render;
}

function lHalf(bits: number): number {
  const lnN = bits * Math.LN2;
  return Math.exp(Math.sqrt(lnN * Math.log(lnN)));
}

function lThird(bits: number): number {
  const lnN = bits * Math.LN2;
  return Math.exp(1.923 * Math.cbrt(lnN) * Math.log(lnN) ** (2 / 3));
}
