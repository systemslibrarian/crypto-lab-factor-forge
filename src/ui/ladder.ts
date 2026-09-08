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
import { state } from './state';

const ACCENT = 'var(--accent)';
const MEASURED = 'var(--ok-text)';

/** Modelled operation counts. Each is the standard heuristic for that method. */
const MODELS: Record<AlgorithmId, { xLabel: string; xs: number[]; f: (x: number) => number; note: string }> = {
  trial: {
    xLabel: 'bits of the SMALLEST factor',
    xs: range(8, 44, 2),
    f: (bits) => {
      const p = 2 ** bits;
      return p / Math.log(p);
    },
    note: 'One division per prime below the factor: linear in the factor itself, so every extra bit doubles the work.',
  },
  fermat: {
    xLabel: 'bits of |p - q|',
    xs: range(1, 40, 2),
    f: (bits) => Math.max(1, 2 ** (2 * bits) / (8 * 2 ** 30)),
    note: 'Steps go as (p - q)² / (8·sqrt(N)); drawn here for a 60-bit N. Two primes chosen independently make this astronomically large.',
  },
  rho: {
    xLabel: 'bits of the SMALLEST factor',
    xs: range(8, 80, 4),
    f: (bits) => 1.18 * Math.sqrt(2 ** bits),
    note: 'Birthday bound: about 1.18·sqrt(p) iterations. The size of N does not appear.',
  },
  pminus1: {
    xLabel: 'bits of the largest prime factor of p - 1',
    xs: range(4, 44, 2),
    f: (bits) => {
      const B = 2 ** bits;
      return B * Math.log2(B);
    },
    note: 'The bound B must reach the largest prime of p - 1. A safe prime puts a prime of size p/2 there, which no affordable B reaches.',
  },
  pplus1: {
    xLabel: 'bits of the largest prime factor of p + 1',
    xs: range(4, 44, 2),
    f: (bits) => {
      const B = 2 ** bits;
      return B * Math.log2(B);
    },
    note: 'Same shape as p-1, in the group of order p + 1. A safe prime does NOT protect this side — p + 1 = 2(q + 1) is arbitrary.',
  },
  ecm: {
    xLabel: 'bits of the SMALLEST factor',
    xs: range(16, 128, 4),
    f: (bits) => {
      const lnp = bits * Math.LN2;
      return Math.exp(Math.sqrt(2 * lnp * Math.log(lnp)));
    },
    note: 'L_p[1/2, sqrt(2)] — sub-exponential in the FACTOR, not in N. This is why ECM is the tool for finding a 60-digit factor of a 300-digit number.',
  },
  qs: {
    xLabel: 'bits of N',
    xs: range(40, 400, 10),
    f: (bits) => {
      const lnN = bits * Math.LN2;
      return Math.exp(Math.sqrt(lnN * Math.log(lnN)));
    },
    note: 'L_N[1/2, 1]. No property of p or q appears anywhere in it — which is exactly why bigger primes are the only defence.',
  },
};

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let x = a; x <= b; x += step) out.push(x);
  return out;
}

/** Measured points from this session's runs, plotted on the method's own axis. */
function measuredFor(id: AlgorithmId): { x: number; y: number }[] {
  const rec = state.runs.get(id);
  if (!rec || !rec.outcome.trace.why) return [];
  const why = rec.outcome.trace.why;
  switch (why.kind) {
    case 'small-factor':
      return [{ x: bitsOf(why.factor), y: Math.max(1, why.divisions) }];
    case 'p-q-gap':
      return [{ x: why.gapBits, y: Math.max(1, why.steps) }];
    case 'smallest-factor':
      return [{ x: why.factorBits, y: Math.max(1, why.steps) }];
    case 'smoothness':
      return why.complete && why.largestPrime !== 'unknown'
        ? [{ x: bitsOf(why.largestPrime), y: Math.max(1, why.bound * Math.log2(why.bound)) }]
        : [];
    case 'relations':
      return [{ x: state.n.toString(2).length, y: Math.max(1, why.relations * why.factorBaseSize) }];
  }
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
        el('h2', { text: 'Seven methods, seven different x-axes' }),
        el('p', {
          text:
            'Plotting every factoring algorithm against "the size of N" is the single most misleading picture in this subject. Only three of the methods here depend on N at all. The rest are driven by a property of p — and each chart below is labelled with the one it is actually driven by.',
        }),
        el('p', {
          class: 'small muted',
          text:
            'Dashed lines are the standard cost model for the method. Solid dots are measurements taken in this browser during your runs on the "Factor N" tab, plotted on the same axis.',
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
      card.append(el('p', { class: 'ladder-axis', text: `cost vs ${model.xLabel}` }));
      card.append(
        logChart(series, {
          xLabel: model.xLabel,
          yLabel: 'operations',
          description: `${meta.name}: modelled cost rising with ${model.xLabel}. ${model.note}`,
        })
      );
      card.append(el('p', { class: 'ladder-note', text: model.note }));
      if (measured.length > 0) {
        card.append(
          el('p', {
            class: 'ladder-note',
            text: `Measured here: ${measured.map((p) => `${p.x} → ${formatOps(p.y)} ops`).join(', ')}.`,
          })
        );
      }
      card.append(chartTable(series, model.xLabel, 'ops'));
      grid.append(card);
    }
    root.append(grid);

    // ── The three that really do scale with N, plus Shor ──────────────────
    const nCard = el('div', { class: 'card' });
    nCard.append(el('h2', { text: 'The only fair "against N" chart' }));
    nCard.append(
      el('p', {
        class: 'small',
        text:
          'These four are the methods whose cost genuinely is a function of the size of N and nothing else. Note the axis: bits of N, running well past anything this page can factor, because the interesting part of the comparison only starts there.',
      })
    );
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
    nCard.append(
      logChart(nSeries, {
        xLabel: 'bits of N',
        yLabel: 'operations',
        description:
          'Three cost curves against the size of N: the quadratic sieve and the number field sieve both climb steeply and off the top of the chart, while Shor stays a shallow cubic line near the bottom.',
        width: 640,
        height: 260,
      })
    );
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
