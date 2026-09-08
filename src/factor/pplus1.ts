/**
 * Williams' p+1.
 *
 * The same trick as p-1, moved into a different group. In the Lucas sequence
 * V_k(a, 1) mod p, when the discriminant a^2 - 4 is a quadratic NON-residue
 * mod p the relevant group has order p + 1, so V_M = 2 (mod p) whenever
 * p + 1 divides M -- and gcd(V_M - 2, N) hands over p. It therefore succeeds
 * when p + 1 is B1-smooth, a completely different condition from p - 1.
 *
 * Whether a^2 - 4 is a non-residue mod the UNKNOWN p is not something the
 * method can check, so it simply tries several bases a. That is honest and it
 * is what the original paper does.
 *
 * Williams, "A p+1 method of factoring", Math. Comp. 39 (1982) 225-234.
 */

import { gcd, primesBelow } from './bigint';
import { smoothnessEvidence } from './pminus1';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep } from './types';

/** V_k(v, 1) mod n, by a binary Lucas ladder on the pair (V_j, V_{j+1}). */
export function lucasV(v: bigint, k: bigint, n: bigint): bigint {
  if (k === 0n) return 2n % n;
  if (k === 1n) return v % n;
  let vk = v % n;
  let vk1 = (v * v - 2n) % n;
  const bits = k.toString(2);
  for (let i = 1; i < bits.length; i++) {
    if (bits[i] === '1') {
      vk = (vk * vk1 - v) % n;
      vk1 = (vk1 * vk1 - 2n) % n;
    } else {
      vk1 = (vk * vk1 - v) % n;
      vk = (vk * vk - 2n) % n;
    }
    vk = ((vk % n) + n) % n;
    vk1 = ((vk1 % n) + n) % n;
  }
  return vk;
}

export function factorPPlus1(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  const B1 = params.smoothBound;
  const primes = primesBelow(B1 + 1);
  // Classic starting values; 2/7 is Williams' own suggestion and the rest give
  // independent discriminants a^2 - 4.
  const bases = [5n, 6n, 7n, 8n, 9n, 11n, 13n, 23n];

  steps.push({
    label: 'Choose a base and a bound',
    detail:
      'V_k(a,1) is a Lucas sequence: V_0 = 2, V_1 = a, V_{2k} = V_k^2 - 2. Where a^2 - 4 is a non-residue mod p, this sequence lives in a group of order p + 1 instead of p - 1.',
    values: [
      { key: 'B1', value: B1.toLocaleString() },
      { key: 'bases to try', value: bases.map(String).join(', ') },
    ],
  });

  let processed = 0;
  for (let bi = 0; bi < bases.length; bi++) {
    let v = bases[bi] % n;
    for (const pr of primes) {
      let e = pr;
      while (e <= B1) {
        v = lucasV(v, BigInt(pr), n);
        e *= pr;
      }
      processed++;
      if ((processed & 0xff) === 0) {
        if (budget.cancelled?.()) {
          return gaveUp('pplus1', steps, ppMetrics(processed, bi), 'cancelled', `base ${bases[bi]}, prime ${pr}`, performance.now() - t0);
        }
        if (performance.now() - t0 > budget.maxMs) {
          return gaveUp('pplus1', steps, ppMetrics(processed, bi), 'time cap reached', `base ${bases[bi]}, prime ${pr}`, performance.now() - t0);
        }
        budget.onProgress?.(processed, primes.length * bases.length, `base ${bases[bi]} at prime ${pr}`);
      }
    }
    const g = gcd(((v - 2n) % n + n) % n, n);
    steps.push({
      label: `Base a = ${bases[bi]}: gcd(V_M - 2, N)`,
      detail:
        g > 1n && g < n
          ? 'V_M is congruent to 2 modulo p but not modulo N, so the difference carries p.'
          : g === n
            ? 'The gcd is N: this base collapsed both factors at once. Try the next base.'
            : 'The gcd is 1: for this base, p + 1 (and q + 1) are not B1-smooth in the group this base lands in.',
      values: [{ key: 'gcd', value: String(g) }],
    });
    if (g > 1n && g < n) {
      // As in p-1: the smoothness belongs to the factor the gcd returned.
      const found = g;
      const p = g < n / g ? g : n / g;
      const q = n / p;
      const why = smoothnessEvidence('p + 1', found + 1n, B1);
      steps.push({
        label: 'Factor recovered',
        detail:
          'Check WHY: factor p + 1. Its largest prime is what had to sit below B1 -- and note that p - 1 for the same p need not be smooth at all.',
        values: [
          { key: 'the factor found', value: String(found) },
          { key: 'the cofactor', value: String(n / found) },
          { key: 'p + 1', value: String(found + 1n) },
          {
            key: 'p + 1 factored',
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
        ms: performance.now() - t0,
        trace: {
          algorithm: 'pplus1',
          steps,
          metrics: [...ppMetrics(processed, bi), { key: 'base', value: String(bases[bi]) }],
          why,
          gaveUp: null,
        },
      };
    }
  }

  steps.push({
    label: 'Every base exhausted',
    detail: `No base produced a factor at B1 = ${B1.toLocaleString()}. For a safe prime p = 2q + 1, p + 1 = 2(q + 1) -- and q + 1 is even but otherwise arbitrary, so this usually fails there too.`,
  });
  return gaveUp(
    'pplus1',
    steps,
    ppMetrics(processed, bases.length),
    `no factor with p+1 smooth to B1 = ${B1.toLocaleString()} on any base`,
    'all bases tried',
    performance.now() - t0
  );
}

function ppMetrics(processed: number, bases: number): { key: string; value: string }[] {
  return [
    { key: 'Lucas ladders', value: processed.toLocaleString() },
    { key: 'bases tried', value: String(bases + 1) },
  ];
}
