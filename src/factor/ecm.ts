/**
 * Lenstra's elliptic curve method.
 *
 * p-1 bets everything on ONE group, (Z/pZ)*, whose order p - 1 is fixed by p.
 * ECM works in E(F_p) for an elliptic curve E of the attacker's choosing, and
 * that order varies over roughly [p + 1 - 2*sqrt(p), p + 1 + 2*sqrt(p)] as the
 * curve changes (Hasse). So a curve whose order is not smooth is not a dead
 * end -- it is one draw, and you draw again. Cost tracks the SMALLEST factor;
 * the size of N is nearly irrelevant.
 *
 * The moment of success is concrete: a scalar multiplication needs to invert
 * a denominator that is 0 mod p but not 0 mod N. In projective XZ coordinates
 * that surfaces as Z with gcd(Z, N) strictly between 1 and N. The failed
 * inversion IS the factor.
 *
 * Curves come from Suyama's parameterization, which produces a Montgomery
 * curve and a point on it from a single parameter sigma.
 *
 * H. W. Lenstra Jr., Annals of Mathematics 126 (1987) 649-673.
 */

import { bitLength, gcd, isqrt, modinv, primesBelow, randomInRange } from './bigint';
import { ladder, xADD, xADDSafe, xMUL, type Pt } from './montgomery';
import { smoothnessEvidence } from './pminus1';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep, type WhyEvidence } from './types';

export interface Curve {
  sigma: bigint;
  a24: bigint;
  P: Pt;
}

/**
 * Suyama's parameterization. Returns either a curve or the factor that fell
 * out of a failed inversion during setup -- which happens, and is a perfectly
 * good way to finish.
 */
export function suyamaCurve(n: bigint, sigma: bigint): { curve: Curve } | { factor: bigint } {
  const u = (sigma * sigma - 5n + 5n * n) % n;
  const v = (4n * sigma) % n;
  const u3 = (((u * u) % n) * u) % n;
  const v3 = (((v * v) % n) * v) % n;
  const diff = (v - u + n) % n;
  const num = (((diff * diff) % n) * diff) % n * ((3n * u + v) % n) % n;
  const den = (16n * u3 % n) * v % n;
  let inv: bigint;
  try {
    inv = modinv(den, n);
  } catch {
    const g = gcd(den, n);
    if (g > 1n && g < n) return { factor: g };
    return { factor: 0n };
  }
  const a24 = (num * inv) % n;
  return { curve: { sigma, a24, P: { X: u3 % n, Z: v3 % n } } };
}

export function factorECM(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  const B1 = params.ecmB1;
  const B2 = params.ecmB2;
  const stage1Primes = primesBelow(B1 + 1);

  steps.push({
    label: 'Set the bounds and start drawing curves',
    detail:
      'Each curve is one lottery ticket: its order over F_p is a fresh number near p + 1, and the run succeeds the first time that order is B1-smooth (B2-smooth with one larger prime allowed).',
    values: [
      { key: 'B1', value: B1.toLocaleString() },
      { key: 'B2', value: B2.toLocaleString() },
      { key: 'curve budget', value: String(params.ecmCurves) },
    ],
  });

  const D = 210;
  const babyJ: number[] = [];
  for (let j = 1; j < D / 2; j += 2) if (gcdInt(j, D) === 1) babyJ.push(j);
  const stage2Primes = B2 > B1 ? primesBelow(B2 + 1).filter((p) => p > B1) : [];

  for (let curveIdx = 0; curveIdx < params.ecmCurves; curveIdx++) {
    if (budget.cancelled?.()) {
      return gaveUp('ecm', steps, ecmMetrics(curveIdx, B1), 'cancelled', `curve ${curveIdx}`, performance.now() - t0);
    }
    if (performance.now() - t0 > budget.maxMs) {
      return gaveUp('ecm', steps, ecmMetrics(curveIdx, B1), 'time cap reached', `curve ${curveIdx}`, performance.now() - t0);
    }
    budget.onProgress?.(curveIdx, params.ecmCurves, `curve ${curveIdx + 1} of ${params.ecmCurves}`);

    const sigma = randomInRange(6n, n - 1n);
    const setup = suyamaCurve(n, sigma);
    if ('factor' in setup) {
      if (setup.factor === 0n) continue;
      return finish(n, setup.factor, steps, curveIdx, sigma, null, B1, 'curve setup', performance.now() - t0);
    }
    const { a24, P } = setup.curve;

    // ── Stage 1 ────────────────────────────────────────────────────────────
    let Q: Pt = P;
    for (const pr of stage1Primes) {
      let e = pr;
      while (e <= B1) {
        Q = xMUL(Q, BigInt(pr), a24, n);
        e *= pr;
      }
    }
    let g = gcd(Q.Z, n);
    if (g > 1n && g < n) {
      return finish(n, g, steps, curveIdx, sigma, { a24, P }, B1, 'stage 1', performance.now() - t0);
    }

    // ── Stage 2: standard continuation, one prime in (B1, B2] allowed ──────
    if (g === 1n && stage2Primes.length > 0) {
      const baby = new Map<number, Pt>();
      for (const j of babyJ) baby.set(j, xMUL(Q, BigInt(j), a24, n));
      const Dpt = xMUL(Q, BigInt(D), a24, n);

      const i0 = Math.max(1, Math.floor(B1 / D));
      let Gprev = xMUL(Q, BigInt(i0 - 1) * BigInt(D), a24, n);
      let G = xMUL(Q, BigInt(i0) * BigInt(D), a24, n);
      const giants = new Map<number, Pt>();
      const iMax = Math.ceil(B2 / D) + 1;
      for (let i = i0; i <= iMax; i++) {
        giants.set(i, G);
        const next = xADD(G, Dpt, Gprev, n);
        Gprev = G;
        G = next;
        if (((i - i0) & 0x3ff) === 0 && performance.now() - t0 > budget.maxMs) {
          return gaveUp('ecm', steps, ecmMetrics(curveIdx, B1), 'time cap reached', `curve ${curveIdx} stage 2`, performance.now() - t0);
        }
      }

      let acc = 1n;
      for (const q of stage2Primes) {
        const i = Math.round(q / D);
        const j = Math.abs(q - i * D);
        const Gi = giants.get(i);
        const Sj = baby.get(j);
        if (!Gi || !Sj) continue;
        // Vanishes mod p exactly when [i*D +/- j]Q is the point at infinity.
        const term = (((Gi.X * Sj.Z) % n) - ((Sj.X * Gi.Z) % n) + n) % n;
        if (term !== 0n) acc = (acc * term) % n;
      }
      g = gcd(acc, n);
      if (g > 1n && g < n) {
        return finish(n, g, steps, curveIdx, sigma, { a24, P }, B2, 'stage 2', performance.now() - t0);
      }
    }
  }

  steps.push({
    label: 'Curve budget exhausted',
    detail: `${params.ecmCurves} curves drawn, none with a B1-smooth order. Raising B1 or drawing more curves both help -- and unlike every other method here, neither depends on how big N is.`,
  });
  return gaveUp(
    'ecm',
    steps,
    ecmMetrics(params.ecmCurves, B1),
    `${params.ecmCurves} curves, none with smooth order at B1 = ${B1.toLocaleString()}`,
    `curve ${params.ecmCurves}`,
    performance.now() - t0
  );
}

function finish(
  n: bigint,
  g: bigint,
  steps: TraceStep[],
  curveIdx: number,
  sigma: bigint,
  curve: { a24: bigint; P: Pt } | null,
  bound: number,
  stage: string,
  ms: number
): FactorOutcome {
  // The curve had smooth order over F_g for the factor g the gcd returned.
  const found = g;
  const p = g < n / g ? g : n / g;
  const q = n / p;

  steps.push({
    label: 'A denominator was not invertible',
    detail:
      'The scalar multiplication tried to work with a projective Z that is 0 modulo p and non-zero modulo N. The group law broke over Z/NZ precisely because it succeeded over F_p -- and gcd reads the factor straight off.',
    values: [
      { key: 'curve #', value: String(curveIdx + 1) },
      { key: 'sigma', value: String(sigma) },
      { key: 'stage', value: stage },
      { key: 'gcd(Z, N)', value: String(g) },
      { key: 'the factor found', value: String(found) },
      { key: 'the cofactor', value: String(n / found) },
    ],
    pivotal: true,
  });

  // ── Invariant I2: compute the curve order over F_p, post hoc ────────────
  let why: WhyEvidence = {
    kind: 'smoothness',
    group: 'curve order #E(F_p)',
    value: 'not computed',
    factorization: [],
    largestPrime: 'unknown',
    bound,
    complete: false,
  };
  if (curve) {
    const ord = curveOrder(curve.a24, curve.P, found);
    if (ord) {
      why = smoothnessEvidence(
        ord.unique ? 'curve order #E(F_p)' : 'order of the point P on E(F_p)',
        ord.order,
        bound
      );
      steps.push({
        label: 'Why this curve and not the last one',
        detail: ord.unique
          ? 'Now that p is known, the order of this curve over F_p is computable directly -- and it is smooth. A curve whose order was not smooth would have run the same code and found nothing.'
          : 'The order of the point is smooth. More than one multiple of it fits inside the Hasse interval, so the full group order is a multiple of this and is not pinned down here.',
        values: [
          { key: 'p', value: String(found) },
          { key: ord.unique ? '#E(F_p)' : 'order of P', value: String(ord.order) },
          {
            key: 'Hasse interval',
            value: `[${found + 1n - 2n * isqrt(found)}, ${found + 1n + 2n * isqrt(found)}]`,
          },
          {
            key: 'factored',
            value:
              why.kind === 'smoothness' && why.complete
                ? why.factorization.map((f) => (f.exponent > 1 ? `${f.prime}^${f.exponent}` : f.prime)).join(' * ')
                : 'cofactor too large to factor here',
          },
        ],
      });
    }
  }

  return {
    p,
    q,
    ms,
    trace: {
      algorithm: 'ecm',
      steps,
      metrics: [
        { key: 'curves tried', value: String(curveIdx + 1) },
        { key: 'sigma', value: String(sigma) },
        { key: 'stage', value: stage },
        { key: 'factor bits', value: String(bitLength(found)) },
      ],
      why,
      gaveUp: null,
    },
  };
}

/**
 * The order of P on the Montgomery curve over F_p, found by walking the Hasse
 * interval [p + 1 - 2*sqrt(p), p + 1 + 2*sqrt(p)] and recording every m with
 * [m]P = O (projectively, Z = 0). `unique` says whether exactly one multiple
 * of the point order lies in the interval, which is when the point order pins
 * the GROUP order too. Returns null if p is large enough that the walk would
 * be slower than the factoring was.
 */
export function curveOrder(
  a24: bigint,
  P: Pt,
  p: bigint,
  maxWalk = 4_000_000
): { order: bigint; unique: boolean } | null {
  const root = isqrt(p);
  const lo = p + 1n - 2n * root;
  const hi = p + 1n + 2n * root;
  const width = hi - lo;
  if (width > BigInt(maxWalk)) return null;

  const a = a24 % p;
  const Pp: Pt = { X: P.X % p, Z: P.Z % p };
  // Reduce mod p FIRST so "Z is zero" and "Z is zero mod p" are the same test
  // inside this walk; every point below lives on E(F_p), not on E(Z/NZ).
  const norm = (pt: Pt): Pt => ({ X: pt.X % p, Z: pt.Z % p });
  let [R, R1] = ladder(Pp, lo, a, p).map(norm) as [Pt, Pt];
  const hits: bigint[] = [];
  for (let m = lo; m <= hi; m++) {
    if (R.Z === 0n) {
      hits.push(m);
      if (hits.length >= 2) break;
    }
    const next = norm(xADDSafe(R1, Pp, R, a, p));
    R = R1;
    R1 = next;
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return { order: hits[0], unique: true };
  // Two multiples in the interval: their difference is the point order, and
  // the group order is some multiple of it that this walk cannot single out.
  return { order: hits[1] - hits[0], unique: false };
}

function gcdInt(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function ecmMetrics(curves: number, bound: number): { key: string; value: string }[] {
  return [
    { key: 'curves tried', value: String(curves) },
    { key: 'B1', value: bound.toLocaleString() },
  ];
}
