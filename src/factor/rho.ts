/**
 * Pollard rho with Brent's cycle detection.
 *
 * Iterate x <- x^2 + c (mod N). Modulo the unknown prime p the sequence must
 * eventually repeat, and by the birthday bound that happens after about
 * sqrt(p) terms -- far sooner than after p terms. Any collision x_i = x_j
 * (mod p) that is NOT a collision mod N makes gcd(x_i - x_j, N) a proper
 * factor. Cost tracks the SMALLEST factor, not the size of N: that is the
 * metric this lab puts on screen.
 *
 * Brent's variant replaces Floyd's two-pointer walk with a doubling stride and
 * batches the gcds, roughly a 25% saving in f-evaluations.
 */

import { abs, bitLength, gcd, isqrt, randomInRange } from './bigint';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep } from './types';

/** How many x_i the trace keeps for the sequence view. */
const SEQUENCE_SAMPLES = 24;

export function factorRho(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  if ((n & 1n) === 0n) {
    return {
      p: 2n,
      q: n / 2n,
      ms: performance.now() - t0,
      trace: {
        algorithm: 'rho',
        steps: [
          {
            label: 'N is even',
            detail: 'rho needs an odd N; the factor 2 is peeled off directly.',
            pivotal: true,
          },
        ],
        metrics: [{ key: 'iterations', value: '0' }],
        why: { kind: 'small-factor', factor: '2', divisions: 1 },
        gaveUp: null,
      },
    };
  }

  let iterations = 0;
  const sequence: string[] = [];

  for (let restart = 0; restart < 32; restart++) {
    const c = randomInRange(1n, n - 1n);
    const y0 = randomInRange(0n, n - 1n);
    steps.push({
      label: restart === 0 ? 'Seed the sequence' : `Restart ${restart} with a new c`,
      detail:
        restart === 0
          ? 'Pick a random c and x0 and iterate f(x) = x^2 + c mod N. Nothing about p is used or known -- the walk is blind.'
          : 'The previous c walked into a collision mod N itself (gcd came out as N). A fresh c gives a different pseudo-random walk.',
      values: [
        { key: 'c', value: String(c) },
        { key: 'x0', value: String(y0) },
      ],
    });

    const f = (v: bigint): bigint => (v * v + c) % n;
    let y = y0;
    let x = 0n;
    let ys = 0n;
    let g = 1n;
    let r = 1n;
    let q = 1n;
    const m = 128n;

    while (g === 1n) {
      x = y;
      for (let i = 0n; i < r; i++) {
        y = f(y);
        iterations++;
        if (sequence.length < SEQUENCE_SAMPLES) sequence.push(String(y));
      }
      let k = 0n;
      while (k < r && g === 1n) {
        ys = y;
        const lim = m < r - k ? m : r - k;
        for (let i = 0n; i < lim; i++) {
          y = f(y);
          iterations++;
          q = (q * abs(x - y)) % n;
        }
        g = gcd(q, n);
        k += m;

        if (budget.cancelled?.()) {
          return gaveUp('rho', steps, rhoMetrics(iterations, restart), 'cancelled', `${iterations} iterations`, performance.now() - t0);
        }
        if (performance.now() - t0 > budget.maxMs) {
          return gaveUp('rho', steps, rhoMetrics(iterations, restart), 'time cap reached', `${iterations} iterations`, performance.now() - t0);
        }
        if (iterations > params.rhoSteps) {
          steps.push({
            label: 'Step cap reached',
            detail: `No collision within ${params.rhoSteps.toLocaleString()} iterations. rho has not proved anything about N -- it simply has not found a cycle yet.`,
          });
          return gaveUp(
            'rho',
            steps,
            rhoMetrics(iterations, restart),
            `no collision in ${params.rhoSteps.toLocaleString()} iterations`,
            `${iterations.toLocaleString()} iterations`,
            performance.now() - t0
          );
        }
        budget.onProgress?.(iterations, params.rhoSteps, `${iterations.toLocaleString()} iterations of f`);
      }
      r *= 2n;
    }

    if (g === n) {
      // The batched product hid the moment of collision; back up and take the
      // gcds one at a time to see whether a proper factor was passed over.
      y = ys;
      g = 1n;
      while (g === 1n) {
        y = f(y);
        iterations++;
        g = gcd(abs(x - y), n);
      }
    }

    if (g !== n && g !== 1n) {
      const p = g < n / g ? g : n / g;
      const other = n / p;
      steps.push({
        label: 'The gcd pops',
        detail:
          'Two terms of the walk collided modulo p while staying distinct modulo N, so their difference is a multiple of p but not of N. gcd hands over p.',
        values: [
          { key: 'gcd(|x - y|, N)', value: String(g) },
          { key: 'p', value: String(p) },
          { key: 'q = N / p', value: String(other) },
          { key: 'iterations', value: iterations.toLocaleString() },
        ],
        pivotal: true,
      });
      steps.push({
        label: 'Read the cost',
        detail: `sqrt(p) is about ${isqrt(p)}, and the walk took ${iterations.toLocaleString()} iterations. The size of N never entered into it.`,
        values: [
          { key: 'sqrt(p)', value: String(isqrt(p)) },
          { key: 'sqrt(N)', value: String(isqrt(n)) },
        ],
      });
      return {
        p,
        q: other,
        ms: performance.now() - t0,
        trace: {
          algorithm: 'rho',
          steps,
          metrics: [
            ...rhoMetrics(iterations, restart),
            { key: 'first x_i', value: sequence.slice(0, 6).join(', ') },
          ],
          why: {
            kind: 'smallest-factor',
            factor: String(p),
            factorBits: bitLength(p),
            steps: iterations,
            sqrtFactor: String(isqrt(p)),
          },
          gaveUp: null,
        },
      };
    }
  }

  return gaveUp(
    'rho',
    steps,
    rhoMetrics(iterations, 32),
    'every restart collapsed to gcd = N',
    `${iterations.toLocaleString()} iterations`,
    performance.now() - t0
  );
}

function rhoMetrics(iterations: number, restarts: number): { key: string; value: string }[] {
  return [
    { key: 'iterations', value: iterations.toLocaleString() },
    { key: 'restarts', value: String(restarts) },
  ];
}
