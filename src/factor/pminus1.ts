/**
 * Pollard's p-1.
 *
 * By Fermat's little theorem a^(p-1) = 1 (mod p). So if p - 1 divides some
 * highly composite M, then a^M = 1 (mod p) and gcd(a^M - 1, N) is a multiple
 * of p. Build M as the product of prime powers up to B1 and the method
 * succeeds exactly when p - 1 is B1-smooth. Nothing about q matters, and
 * nothing about the size of N matters.
 *
 * Stage 2 extends this to one remaining prime factor of p - 1 between B1 and
 * B2, which is the common case: p - 1 = (smooth part) * (one middling prime).
 *
 * Pollard, Proc. Cambridge Philos. Soc. 76 (1974) 521-528.
 */

import { gcd, modpow, primesBelow } from './bigint';
import { factorSmall } from './primality';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep, type WhyEvidence } from './types';

export function factorPMinus1(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  const B1 = params.smoothBound;
  const B2 = Math.max(B1, params.ecmB2);
  const primes = primesBelow(B1 + 1);

  steps.push({
    label: 'Choose the bound',
    detail:
      'Stage 1 raises a to every prime power below B1. That reaches p when the order of a modulo p is built entirely from primes at or below B1 -- which, for a p - 1 built that way, is almost always. The learner sets B1, and B1 is what decides which primes are within reach.',
    values: [
      { key: 'B1', value: B1.toLocaleString() },
      { key: 'primes <= B1', value: primes.length.toLocaleString() },
      { key: 'base a', value: '2' },
    ],
  });

  let a = 2n;
  let processed = 0;
  for (const pr of primes) {
    let e = pr;
    while (e <= B1) {
      a = modpow(a, BigInt(pr), n);
      e *= pr;
    }
    processed++;
    if ((processed & 0xff) === 0) {
      if (budget.cancelled?.()) {
        return gaveUp('pminus1', steps, [{ key: 'stage-1 primes', value: String(processed) }], 'cancelled', `prime ${pr}`, performance.now() - t0);
      }
      if (performance.now() - t0 > budget.maxMs) {
        return gaveUp('pminus1', steps, [{ key: 'stage-1 primes', value: String(processed) }], 'time cap reached', `prime ${pr}`, performance.now() - t0);
      }
      budget.onProgress?.(processed, primes.length, `stage 1 at prime ${pr}`);
    }
  }

  const g1 = gcd(a - 1n, n);
  steps.push({
    label: 'Stage 1 gcd',
    detail:
      'a is now a^M mod N for M = product of prime powers <= B1. If p - 1 divides M then a^M - 1 is a multiple of p, and the gcd sees it.',
    values: [
      { key: 'gcd(a^M - 1, N)', value: String(g1) },
      { key: 'prime powers used', value: primes.length.toLocaleString() },
    ],
  });

  if (g1 > 1n && g1 < n) {
    return succeed(n, g1, steps, B1, 'stage 1', performance.now() - t0, processed);
  }
  if (g1 === n) {
    steps.push({
      label: 'gcd came out as N',
      detail:
        'Both p - 1 and q - 1 are B1-smooth, so the exponent killed BOTH factors at once and the gcd is N itself. Lowering B1 separates them.',
    });
    return gaveUp('pminus1', steps, [{ key: 'stage-1 primes', value: String(processed) }], 'gcd = N: every factor was B1-smooth at once', 'stage 1', performance.now() - t0);
  }

  // ── Stage 2: one prime of p-1 allowed in (B1, B2] ──────────────────────
  if (B2 > B1) {
    steps.push({
      label: 'Stage 2',
      detail:
        'Allow p - 1 one extra prime factor q in (B1, B2]. Walk a^M through each such q by repeatedly multiplying by a^(gap), accumulating the differences into one product so only a single gcd is needed.',
      values: [{ key: 'B2', value: B2.toLocaleString() }],
    });
    const stage2Primes = primesBelow(B2 + 1).filter((p) => p > B1);
    if (stage2Primes.length > 0) {
      // Precompute a^(2d) for the even gaps between consecutive primes.
      const gapCache = new Map<number, bigint>();
      const a2 = (a * a) % n;
      let cur = modpow(a, BigInt(stage2Primes[0]), n);
      let acc = 1n;
      let prev = stage2Primes[0];
      acc = (cur - 1n) % n;
      for (let i = 1; i < stage2Primes.length; i++) {
        const gap = stage2Primes[i] - prev;
        let step = gapCache.get(gap);
        if (!step) {
          step = modpow(a2, BigInt(gap / 2), n);
          gapCache.set(gap, step);
        }
        cur = (cur * step) % n;
        acc = (acc * ((cur - 1n + n) % n)) % n;
        prev = stage2Primes[i];
        if ((i & 0x3ff) === 0) {
          if (budget.cancelled?.() || performance.now() - t0 > budget.maxMs) {
            return gaveUp('pminus1', steps, [{ key: 'stage-2 primes', value: String(i) }], budget.cancelled?.() ? 'cancelled' : 'time cap reached', `stage 2 prime ${prev}`, performance.now() - t0);
          }
          budget.onProgress?.(i, stage2Primes.length, `stage 2 at prime ${prev}`);
        }
      }
      const g2 = gcd(acc, n);
      steps.push({
        label: 'Stage 2 gcd',
        detail: 'One gcd over the accumulated product of (a^(M*q) - 1) for every stage-2 prime q.',
        values: [{ key: 'gcd', value: String(g2) }],
      });
      if (g2 > 1n && g2 < n) {
        return succeed(n, g2, steps, B2, 'stage 2', performance.now() - t0, processed);
      }
    }
  }

  steps.push({
    label: 'No factor found',
    detail: `Neither p - 1 nor q - 1 is smooth enough for B1 = ${B1.toLocaleString()}. Raising B1 costs time linearly; a safe prime p = 2q + 1 puts a prime of size p/2 into p - 1 and defeats any B1 you can afford.`,
  });
  return gaveUp(
    'pminus1',
    steps,
    [{ key: 'stage-1 primes', value: String(processed) }],
    `no factor with p-1 smooth to B1 = ${B1.toLocaleString()}`,
    'stage 2 complete',
    performance.now() - t0
  );
}

function succeed(
  n: bigint,
  g: bigint,
  steps: TraceStep[],
  bound: number,
  stage: string,
  ms: number,
  processed: number
): FactorOutcome {
  // `g` is the factor the exponent actually killed, and it is g's OWN g - 1
  // that had to be smooth. That is not always the smaller of the two, so the
  // evidence follows g while the reported pair stays ordered for display.
  const found = g;
  const p = g < n / g ? g : n / g;
  const q = n / p;
  const why = smoothnessEvidence('p - 1', found - 1n, bound);
  steps.push({
    label: `Factor recovered in ${stage}`,
    detail:
      'The gcd is p. Now check WHY: factor p - 1 and look at its largest prime -- that number, not the size of N, is what decided this run.',
    values: [
      { key: 'the factor found', value: String(found) },
      { key: 'the cofactor', value: String(n / found) },
      { key: 'p - 1', value: String(found - 1n) },
      {
        key: 'p - 1 factored',
        value:
          why.kind === 'smoothness' && why.complete
            ? why.factorization.map((f) => (f.exponent > 1 ? `${f.prime}^${f.exponent}` : f.prime)).join(' * ')
            : 'cofactor too large to factor here',
      },
    ],
    pivotal: true,
  });
  return {
    p,
    q,
    ms,
    trace: {
      algorithm: 'pminus1',
      steps,
      metrics: [
        { key: 'stage', value: stage },
        { key: 'B1', value: bound.toLocaleString() },
        { key: 'stage-1 primes', value: String(processed) },
      ],
      why,
      gaveUp: null,
    },
  };
}

/**
 * Invariant I2: the smoothness claim is FACTORED, never asserted -- and whether
 * it actually clears the bound is computed here too, so no caller can render a
 * sentence the numbers contradict.
 */
export function smoothnessEvidence(group: string, value: bigint, bound: number): WhyEvidence {
  const f = factorSmall(value);
  if (!f) {
    return {
      kind: 'smoothness',
      group,
      value: String(value),
      factorization: [],
      largestPrime: 'unknown',
      bound,
      complete: false,
      withinBound: false,
    };
  }
  const largest = f.reduce((acc, x) => (x.prime > acc ? x.prime : acc), 1n);
  return {
    kind: 'smoothness',
    group,
    value: String(value),
    factorization: f.map((x) => ({ prime: String(x.prime), exponent: x.exponent })),
    largestPrime: String(largest),
    bound,
    complete: true,
    withinBound: largest <= BigInt(bound),
  };
}
