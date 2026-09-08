/**
 * Fermat's difference of squares.
 *
 * Write N = a^2 - b^2 = (a - b)(a + b). Start at a = ceil(sqrt(N)) and walk
 * upward until a^2 - N is a perfect square. The correct a is exactly
 * (p + q)/2, so the number of steps is (p + q)/2 - ceil(sqrt(N)) -- roughly
 * (p - q)^2 / (8 * sqrt(N)). Close primes fall in a handful of steps; balanced,
 * independently chosen primes are hopeless. "Do not generate q by nudging p
 * upward" is the rule this defends against.
 */

import { isqrt, isqrtCeil, bitLength } from './bigint';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep } from './types';

export function factorFermat(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  if ((n & 1n) === 0n) {
    // Fermat's identity needs odd N: with N even, a - b and a + b have the
    // same parity and the search cannot represent the factor 2.
    steps.push({
      label: 'N is even',
      detail: 'Difference of squares needs an odd N. Peel the factor 2 off first.',
      pivotal: true,
    });
    return {
      p: 2n,
      q: n / 2n,
      ms: performance.now() - t0,
      trace: {
        algorithm: 'fermat',
        steps,
        metrics: [{ key: 'a-steps', value: '0' }],
        why: { kind: 'small-factor', factor: '2', divisions: 1 },
        gaveUp: null,
      },
    };
  }

  const root = isqrtCeil(n);
  steps.push({
    label: 'Start at ceil(sqrt(N))',
    detail:
      'Any factorization N = p*q corresponds to a = (p+q)/2 and b = (q-p)/2, and a is at least sqrt(N). So the search starts there and only ever goes up.',
    values: [
      { key: 'ceil(sqrt(N))', value: String(root) },
      { key: 'cap', value: `${params.fermatSteps.toLocaleString()} steps` },
    ],
  });

  let a = root;
  for (let k = 0; k < params.fermatSteps; k++) {
    const b2 = a * a - n;
    if (b2 >= 0n) {
      const b = isqrt(b2);
      if (b * b === b2) {
        const p = a - b;
        const q = a + b;
        if (p > 1n && p < n) {
          const gap = q - p;
          steps.push({
            label: 'a^2 - N is a perfect square',
            detail: `After ${k.toLocaleString()} steps, a^2 - N = b^2 exactly. N = (a-b)(a+b) falls out with no further work.`,
            values: [
              { key: 'a', value: String(a) },
              { key: 'b', value: String(b) },
              { key: 'p = a - b', value: String(p) },
              { key: 'q = a + b', value: String(q) },
            ],
            pivotal: true,
          });
          return {
            p,
            q,
            ms: performance.now() - t0,
            trace: {
              algorithm: 'fermat',
              steps,
              metrics: [
                { key: 'a-steps', value: k.toLocaleString() },
                { key: '|p - q|', value: String(gap) },
              ],
              why: {
                kind: 'p-q-gap',
                gap: String(gap),
                gapBits: bitLength(gap),
                steps: k,
                sqrtN: String(root),
              },
              gaveUp: null,
            },
          };
        }
      }
    }
    a += 1n;
    if ((k & 0x3ff) === 0) {
      if (budget.cancelled?.()) {
        return gaveUp('fermat', steps, [{ key: 'a-steps', value: k.toLocaleString() }], 'cancelled', `a = ${a}`, performance.now() - t0);
      }
      if (performance.now() - t0 > budget.maxMs) {
        return gaveUp('fermat', steps, [{ key: 'a-steps', value: k.toLocaleString() }], 'time cap reached', `a = ${a}`, performance.now() - t0);
      }
      budget.onProgress?.(k, params.fermatSteps, `a = ceil(sqrt(N)) + ${k}`);
    }
  }

  steps.push({
    label: 'Cap reached',
    detail: `No perfect square within ${params.fermatSteps.toLocaleString()} steps of ceil(sqrt(N)). That is a POSITIVE result about N: its two factors are far apart. It is not a factorization.`,
  });
  return gaveUp(
    'fermat',
    steps,
    [{ key: 'a-steps', value: params.fermatSteps.toLocaleString() }],
    `no square within ${params.fermatSteps.toLocaleString()} steps of ceil(sqrt(N))`,
    `a = ${a}`,
    performance.now() - t0
  );
}
