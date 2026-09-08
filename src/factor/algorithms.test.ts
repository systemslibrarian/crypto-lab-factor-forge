import { describe, expect, it } from 'vitest';
import { isqrtCeil } from './bigint';
import { curveOrder, suyamaCurve } from './ecm';
import { lucasV } from './pplus1';
import { gf2NullSpace, smoothVector } from './qs';
import { ALGORITHM_ORDER, REGISTRY } from './registry';
import { largestPrimeFactor } from './primality';
import { DEFAULT_PARAMS, type AlgorithmId } from './types';
import { VECTORS } from './vectors';
import { verifyFactorization } from '../verify/verify';

const BUDGET = { maxMs: 25_000 };

/** C1 — every algorithm's output passes the verifier on every pinned vector. */
describe('C1: every reported factorization is verified (invariant I1)', () => {
  for (const v of VECTORS) {
    for (const id of ALGORITHM_ORDER) {
      it(`${v.id} / ${id}`, () => {
        const out = REGISTRY[id](v.n, DEFAULT_PARAMS, BUDGET);
        const verdict = verifyFactorization({ n: v.n, p: out.p, q: out.q });
        if (out.p === null) {
          // A give-up must SAY it gave up and must not carry a why-evidence.
          expect(verdict.status).toBe('no-claim');
          expect(out.trace.gaveUp).not.toBeNull();
          expect(out.trace.why).toBeNull();
          return;
        }
        expect(verdict.status).toBe('verified');
        expect(verdict.productMatchesN).toBe(true);
        expect(verdict.fullyFactored).toBe(true);
        expect(out.p! * out.q!).toBe(v.n);
        expect(new Set([out.p, out.q])).toEqual(new Set([v.p, v.q]));
        expect(out.trace.gaveUp).toBeNull();
        expect(out.trace.why).not.toBeNull();
      });
    }
  }
});

describe('the pinned expectations are the measured behaviour', () => {
  for (const v of VECTORS) {
    it(`${v.id}: falls to ${v.falls.join(', ')} and resists ${v.resists.join(', ')}`, () => {
      const succeeded = (id: AlgorithmId): boolean => {
        const out = REGISTRY[id](v.n, DEFAULT_PARAMS, BUDGET);
        return verifyFactorization({ n: v.n, p: out.p, q: out.q }).status === 'verified';
      };
      for (const id of v.falls) expect(succeeded(id), `${id} should factor ${v.id}`).toBe(true);
      for (const id of v.resists) expect(succeeded(id), `${id} should NOT factor ${v.id}`).toBe(false);
    });
  }
});

/** C2 — rho's cost tracks the SMALLEST factor, not the size of N. */
describe('C2: rho step count scales with the smallest factor', () => {
  it('20 runs each on a 17-bit and a 30-bit factor, inside a stated tolerance', () => {
    const small = VECTORS.find((v) => v.id === 'small-factor')!; // p = 99,991 (17 bits)
    const bigger = VECTORS.find((v) => v.id === 'safe-primes')!; // p = 604,086,479 (30 bits)
    const median = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    const steps = (n: bigint): number => {
      const out = REGISTRY.rho(n, DEFAULT_PARAMS, BUDGET);
      expect(out.p).not.toBeNull();
      const w = out.trace.why!;
      expect(w.kind).toBe('smallest-factor');
      return w.kind === 'smallest-factor' ? w.steps : 0;
    };

    const smallRuns = Array.from({ length: 20 }, () => steps(small.n));
    const bigRuns = Array.from({ length: 20 }, () => steps(bigger.n));

    // Expected work is ~1.18*sqrt(p); sqrt ratio here is about 78x. rho is a
    // randomised algorithm, so the claim is on the MEDIAN with a wide band --
    // stated, not hidden.
    const sqrtRatio = Math.sqrt(Number(bigger.p) / Number(small.p));
    const observed = median(bigRuns) / median(smallRuns);
    expect(observed).toBeGreaterThan(sqrtRatio / 6);
    expect(observed).toBeLessThan(sqrtRatio * 6);

    // And the point of the claim: N is BIGGER in the small-factor vector, yet
    // rho is faster there. Cost does not track N.
    expect(small.n).toBeLessThan(bigger.n * 1n);
    expect(median(smallRuns)).toBeLessThan(median(bigRuns));
  });
});

/** C3 — p-1 succeeds on smooth p-1 and FAILS on the safe-prime vector. */
describe('C3: Pollard p-1 depends on smoothness, and safe primes remove it', () => {
  it('succeeds on the smooth-p-1 vector, with the smoothness factored as evidence', () => {
    const v = VECTORS.find((x) => x.id === 'smooth-pminus1')!;
    const out = REGISTRY.pminus1(v.n, DEFAULT_PARAMS, BUDGET);
    expect(verifyFactorization({ n: v.n, p: out.p, q: out.q }).status).toBe('verified');
    const why = out.trace.why!;
    expect(why.kind).toBe('smoothness');
    if (why.kind !== 'smoothness') throw new Error('unreachable');
    expect(why.complete).toBe(true);
    // Independent re-derivation: recompute the factorization of p-1 here.
    const product = why.factorization.reduce(
      (acc, f) => acc * BigInt(f.prime) ** BigInt(f.exponent),
      1n
    );
    // The evidence names the factor whose p - 1 was smooth; it is one of the two.
    expect([out.p, out.q].map(String)).toContain(String(product + 1n));
    expect(BigInt(why.largestPrime)).toBeLessThanOrEqual(BigInt(DEFAULT_PARAMS.smoothBound));
  });

  it('FAILS on the safe-prime vector and says why', () => {
    const v = VECTORS.find((x) => x.id === 'safe-primes')!;
    const out = REGISTRY.pminus1(v.n, DEFAULT_PARAMS, BUDGET);
    expect(out.p).toBeNull();
    expect(out.trace.gaveUp).not.toBeNull();
    // Independently: both p-1 and q-1 really do keep a large prime factor.
    expect(largestPrimeFactor(v.p - 1n)!).toBeGreaterThan(BigInt(DEFAULT_PARAMS.smoothBound));
    expect(largestPrimeFactor(v.q - 1n)!).toBeGreaterThan(BigInt(DEFAULT_PARAMS.smoothBound));
  });
});

/** C4 — Fermat succeeds on close primes and fails inside its cap on balanced ones. */
describe('C4: Fermat depends on |p - q|', () => {
  it('succeeds on the close-primes vector in a handful of steps', () => {
    const v = VECTORS.find((x) => x.id === 'close-primes')!;
    const out = REGISTRY.fermat(v.n, DEFAULT_PARAMS, BUDGET);
    expect(verifyFactorization({ n: v.n, p: out.p, q: out.q }).status).toBe('verified');
    const why = out.trace.why!;
    if (why.kind !== 'p-q-gap') throw new Error('expected a p-q-gap explanation');
    expect(BigInt(why.gap)).toBe(v.q - v.p);
    // Independent re-derivation of the step count: a = (p+q)/2.
    expect(BigInt(why.steps)).toBe((v.p + v.q) / 2n - isqrtCeil(v.n));
    expect(why.steps).toBeLessThan(10);
  });

  it('fails within its cap on the balanced vector', () => {
    const v = VECTORS.find((x) => x.id === 'safe-primes')!;
    const out = REGISTRY.fermat(v.n, DEFAULT_PARAMS, BUDGET);
    expect(out.p).toBeNull();
    // The distance it would have had to walk, computed independently.
    expect((v.p + v.q) / 2n - isqrtCeil(v.n)).toBeGreaterThan(BigInt(DEFAULT_PARAMS.fermatSteps));
  });
});

/** C5 — ECM succeeds and its curve order is verified smooth post hoc. */
describe('C5: ECM succeeds and the curve order is computed, not asserted', () => {
  it('factors the ecm-only vector and reports a smooth order', () => {
    const v = VECTORS.find((x) => x.id === 'ecm-only')!;
    const out = REGISTRY.ecm(v.n, DEFAULT_PARAMS, { maxMs: 60_000 });
    expect(verifyFactorization({ n: v.n, p: out.p, q: out.q }).status).toBe('verified');
    const why = out.trace.why!;
    if (why.kind !== 'smoothness') throw new Error('expected smoothness evidence');
    expect(why.complete).toBe(true);
    const order = BigInt(why.value);
    // Hasse: any curve order over F_p lies within 2*sqrt(p) of p + 1.
    const p = BigInt(
      [out.p!, out.q!].find((f) => {
        const r = BigInt(Math.floor(Math.sqrt(Number(f))));
        return order > f - 3n * r && order < f + 3n * r;
      }) ?? out.p!
    );
    const root = BigInt(Math.floor(Math.sqrt(Number(p))));
    expect(order).toBeGreaterThan(p - 3n * root);
    expect(order).toBeLessThan(p + 3n * root);
    // The order really factors as reported, and really is smooth.
    const product = why.factorization.reduce(
      (acc, f) => acc * BigInt(f.prime) ** BigInt(f.exponent),
      1n
    );
    expect(product).toBe(order);
    expect(BigInt(why.largestPrime)).toBeLessThanOrEqual(BigInt(DEFAULT_PARAMS.ecmB2));
  });

  it('curveOrder finds an order consistent with Hasse on a known prime', () => {
    const p = 1000003n;
    const setup = suyamaCurve(p * 999983n, 12345n);
    if ('factor' in setup) throw new Error('unexpected factor during setup');
    const ord = curveOrder(setup.curve.a24, setup.curve.P, p);
    expect(ord).not.toBeNull();
    const root = 1000n;
    expect(ord!.order).toBeGreaterThan(p + 1n - 2n * root - 1n);
    expect(ord!.order).toBeLessThan(p + 1n + 2n * root + 1n);
  });
});

/** C6 — QS produces a nontrivial x^2 = y^2 pair. */
describe('C6: the quadratic sieve produces a real congruence of squares', () => {
  it('x^2 = y^2 (mod N) with x != +/- y on the pinned vector', () => {
    const v = VECTORS.find((x) => x.id === 'qs-target')!;
    const out = REGISTRY.qs(v.n, DEFAULT_PARAMS, { maxMs: 60_000 });
    expect(verifyFactorization({ n: v.n, p: out.p, q: out.q }).status).toBe('verified');
    const why = out.trace.why!;
    if (why.kind !== 'relations') throw new Error('expected relation evidence');
    const x = BigInt(why.x);
    const y = BigInt(why.y);
    expect((x * x) % v.n).toBe((y * y) % v.n);
    expect(x % v.n).not.toBe(y % v.n);
    expect((x + y) % v.n).not.toBe(0n);
  });

  it('smoothVector multiplies back exactly, and rejects non-smooth values', () => {
    const fb = [2, 3, 5, 7, 11];
    const exps = smoothVector(-2n * 3n * 3n * 11n, fb)!;
    expect(exps[0]).toBe(1);
    const product = fb.reduce((acc, p, i) => acc * BigInt(p) ** BigInt(exps[i + 1]), 1n);
    expect(product).toBe(2n * 3n * 3n * 11n);
    expect(smoothVector(13n * 4n, fb)).toBeNull();
  });

  it('gf2NullSpace returns combinations that really sum to zero mod 2', () => {
    const rows = [
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 0],
      [1, 1, 1],
    ];
    const deps = gf2NullSpace(rows, 3);
    expect(deps.length).toBeGreaterThan(0);
    for (const dep of deps) {
      const sum = new Array(3).fill(0);
      dep.forEach((bit, i) => {
        if (bit) rows[i].forEach((v, c) => (sum[c] ^= v));
      });
      expect(sum).toEqual([0, 0, 0]);
    }
  });
});

describe('Lucas sequences', () => {
  it('lucasV matches the recurrence V_{k+1} = a*V_k - V_{k-1}', () => {
    const n = 1000003n;
    const a = 7n;
    let prev = 2n;
    let cur = a;
    for (let k = 1n; k < 60n; k++) {
      expect(lucasV(a, k, n)).toBe(cur);
      const next = ((a * cur - prev) % n + n) % n;
      prev = cur;
      cur = next;
    }
  });
});
