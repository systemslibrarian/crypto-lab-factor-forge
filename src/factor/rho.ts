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
 * Brent's variant replaces Floyd's two-pointer walk with a doubling stride --
 * one evaluation of f per step instead of Floyd's three -- and batches the
 * differences into a single product so one gcd covers up to 128 steps (the
 * early rounds cover fewer, since the batch is capped by the stride). Brent reports
 * the combined method as about 25% faster than Pollard's original.
 *
 * WHAT RHO DOES NOT DO: stall on a perfect square. That claim was in this
 * repository -- in tree.ts, in bigint.ts and on the race board -- and it is
 * wrong. Take N = p^2. Reduced mod p the iteration is still x <- x^2 + (c mod
 * p), the identical recurrence on the identical state space, so the walk
 * collides mod p on the ordinary birthday schedule of about sqrt(p) terms --
 * nothing about the second factor being equal to the first touches that. The
 * difference between the two colliding terms is then a multiple of p, and
 * gcd(x_i - x_j, p^2) returns p unless the two terms happen to agree mod p^2 as
 * well. They rarely do: a collision mod p is one coincidence among about p
 * possibilities, and a simultaneous collision mod p^2 is a second independent
 * coincidence among about p more, so the first collision is overwhelmingly a
 * clean one. Measured here on p = 1000003, N = p^2 splits in about 1,700
 * iterations against sqrt(p) = 1000, first c, no restart -- and on p =
 * 15485863, 32452843, 179424673 and 2147483647 likewise, every one on the first
 * c with no restart.
 *
 * What is true of N = p^2 is only what is true of every N: rho's cost is set by
 * the smallest prime factor, and p^2 has the largest smallest-factor any N of
 * its size can have, p = sqrt(N), so it costs N^(1/4) -- exactly what an N with
 * two equal-SIZE primes costs, which is the shape RSA deliberately uses. The
 * genuine failure modes are the one this file reports, sqrt(p) not fitting
 * inside the iteration cap, and the transient one where the batched product is
 * divisible by N itself so the gcd comes back as N -- which the backtrack
 * below, and then a fresh c, recover from. Perfect powers are peeled in tree.ts
 * for a different reason; see there.
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
            detail:
              'An even N is split by inspection: the walk never starts. This is a shortcut past a trivial case, not a limitation of rho.',
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
            detail: `No usable collision within ${params.rhoSteps.toLocaleString()} iterations. rho has not proved anything about N -- the walk is still going, and the only thing that failing here suggests is that the smallest factor is large enough for sqrt(p) to exceed the cap.`,
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
        detail: `sqrt(p) is about ${isqrt(p)}, and the walk took ${iterations.toLocaleString()} iterations. The size of N sets the cost of each multiplication, but not the NUMBER of them: that is fixed by the smallest factor alone.`,
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
