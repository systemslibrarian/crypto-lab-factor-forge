/**
 * The verifier — invariant I1.
 *
 * NOTHING an algorithm reports is shown as a result until it has passed
 * through here: the claimed factors are multiplied back to N, and each is put
 * through Miller-Rabin. This module deliberately imports NO algorithm module,
 * so a bug in one of them cannot also be the thing that blesses its own
 * output. `verify.import-isolation.test.ts` asserts that mechanically.
 *
 * Also invariant I3: timing is passed through untouched. Nothing here
 * extrapolates a browser measurement to an RSA-sized modulus.
 */

import { bitLength, perfectPower } from '../factor/bigint';
import { millerRabin } from '../factor/primality';

export type VerifyStatus = 'verified' | 'refuted' | 'no-claim';

export interface FactorClaim {
  n: bigint;
  p: bigint | null;
  q: bigint | null;
}

export interface VerifiedFactor {
  value: string;
  bits: number;
  prime: boolean;
  /** false when Miller-Rabin's answer rests on random bases, not the proven set. */
  deterministic: boolean;
  bases: number;
}

export interface Verdict {
  status: VerifyStatus;
  /** p * q, recomputed here. */
  product: string | null;
  productMatchesN: boolean;
  factors: VerifiedFactor[];
  /** True only when every factor is prime — otherwise the split is partial. */
  fullyFactored: boolean;
  /** Human-readable reason, always populated. */
  reason: string;
}

/**
 * Check a claimed split of N. Every branch that is not a proven, multiplied-out
 * match is 'refuted' or 'no-claim'; there is no benefit-of-the-doubt path.
 */
export function verifyFactorization(claim: FactorClaim): Verdict {
  const { n, p, q } = claim;
  if (p === null || q === null) {
    return {
      status: 'no-claim',
      product: null,
      productMatchesN: false,
      factors: [],
      fullyFactored: false,
      reason: 'The algorithm reported no factor.',
    };
  }
  if (p <= 1n || q <= 1n) {
    return {
      status: 'refuted',
      product: String(p * q),
      productMatchesN: p * q === n,
      factors: [],
      fullyFactored: false,
      reason: 'A claimed factor is 1 or smaller — that is a trivial split, not a factorization.',
    };
  }
  const product = p * q;
  if (product !== n) {
    return {
      status: 'refuted',
      product: String(product),
      productMatchesN: false,
      factors: [],
      fullyFactored: false,
      reason: `p * q = ${product}, which is not N. The claim is rejected.`,
    };
  }

  const factors = [p, q].map((f) => {
    const v = millerRabin(f);
    return {
      value: String(f),
      bits: bitLength(f),
      prime: v.prime,
      deterministic: v.deterministic,
      bases: v.bases,
    };
  });
  const fullyFactored = factors.every((f) => f.prime);
  return {
    status: 'verified',
    product: String(product),
    productMatchesN: true,
    factors,
    fullyFactored,
    reason: fullyFactored
      ? 'p * q = N exactly, and Miller-Rabin calls both factors prime.'
      : 'p * q = N exactly, but at least one factor is composite — this is a partial split, not a full factorization.',
  };
}

/** Shape of N that changes what the algorithms can even mean. */
export interface Shape {
  even: boolean;
  prime: boolean;
  primeDeterministic: boolean;
  perfectPower: { base: string; exponent: number } | null;
  bits: number;
  /** Set when N is too small or otherwise not a factoring target. */
  degenerate: string | null;
}

export function describeShape(n: bigint): Shape {
  const bits = bitLength(n);
  if (n < 2n) {
    return {
      even: n % 2n === 0n,
      prime: false,
      primeDeterministic: true,
      perfectPower: null,
      bits,
      degenerate: 'N must be at least 2.',
    };
  }
  const mr = millerRabin(n);
  const pp = perfectPower(n);
  return {
    even: (n & 1n) === 0n,
    prime: mr.prime,
    primeDeterministic: mr.deterministic,
    perfectPower: pp ? { base: String(pp.base), exponent: pp.exponent } : null,
    bits,
    degenerate: mr.prime ? 'N is prime — there is nothing to factor.' : null,
  };
}
