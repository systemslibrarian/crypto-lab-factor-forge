/**
 * XZ-only arithmetic on a Montgomery curve  B*y^2 = x^3 + A*x^2 + x  over
 * Z/nZ, where n is the number being factored and is NOT prime.
 *
 * Working "over Z/nZ" is the whole trick: the formulas below are the correct
 * group law over F_p for each prime p | n, and they are computed with the
 * ring's arithmetic. They only break when an inversion is needed and the
 * element is a zero divisor -- and that break IS the factorization.
 *
 * Montgomery, "Speeding the Pollard and elliptic curve methods of
 * factorization", Math. Comp. 48 (1987) 243-264.
 */

export interface Pt {
  X: bigint;
  Z: bigint;
}

/** Point doubling. a24 = (A + 2) / 4 mod n. */
export function xDBL(P: Pt, a24: bigint, n: bigint): Pt {
  const t1 = (P.X + P.Z) % n;
  const t2 = (P.X - P.Z + n) % n;
  const s = (t1 * t1) % n;
  const d = (t2 * t2) % n;
  const diff = (s - d + n) % n;
  return {
    X: (s * d) % n,
    Z: (diff * ((d + ((a24 * diff) % n)) % n)) % n,
  };
}

/** Differential addition: given P, Q and P - Q, return P + Q. */
export function xADD(P: Pt, Q: Pt, PmQ: Pt, n: bigint): Pt {
  const t1 = (P.X + P.Z) % n;
  const t2 = (P.X - P.Z + n) % n;
  const t3 = (Q.X + Q.Z) % n;
  const t4 = (Q.X - Q.Z + n) % n;
  const u = (t2 * t3) % n;
  const v = (t1 * t4) % n;
  const su = (u + v) % n;
  const sv = (u - v + n) % n;
  return {
    X: (PmQ.Z * ((su * su) % n)) % n,
    Z: (PmQ.X * ((sv * sv) % n)) % n,
  };
}

export const INFINITY: Pt = { X: 1n, Z: 0n };

export function isInfinity(P: Pt): boolean {
  return P.Z === 0n;
}

/**
 * Differential addition that is correct when one of its inputs is the point at
 * infinity.
 *
 * The bare `xADD` formula is not: with Q = O it returns a point whose Z is
 * zero, i.e. it reports O where the answer is P. That silent wrong answer is
 * exactly what made an earlier version of the post-hoc order walk report
 * "order 2" for a curve of order 1,000,068 -- once the walk stepped through
 * infinity, every subsequent point looked like infinity too. Only an EXACT
 * zero is the identity here; a Z that is zero modulo one prime factor of a
 * composite n is a factor, not an identity, and is left for `gcd` to find.
 */
export function xADDSafe(P: Pt, Q: Pt, PmQ: Pt, a24: bigint, n: bigint): Pt {
  if (isInfinity(P)) return Q;
  if (isInfinity(Q)) return P;
  // P - Q = O means P = Q, and the difference formula degenerates to doubling.
  if (isInfinity(PmQ)) return xDBL(P, a24, n);
  return xADD(P, Q, PmQ, n);
}

/**
 * Montgomery ladder: returns ([k]P, [k+1]P). The pair is what the post-hoc
 * order walk needs as its seed, and the invariant R1 - R0 = P is what makes
 * the infinity cases above resolvable at all.
 */
export function ladder(P: Pt, k: bigint, a24: bigint, n: bigint): [Pt, Pt] {
  if (k === 0n) return [INFINITY, P];
  if (k === 1n) return [P, xDBL(P, a24, n)];
  let R0 = P;
  let R1 = xDBL(P, a24, n);
  const bits = k.toString(2);
  for (let i = 1; i < bits.length; i++) {
    if (bits[i] === '1') {
      const sum = xADDSafe(R1, R0, P, a24, n);
      R1 = xDBL(R1, a24, n);
      R0 = sum;
    } else {
      const sum = xADDSafe(R0, R1, P, a24, n);
      R0 = xDBL(R0, a24, n);
      R1 = sum;
    }
  }
  return [R0, R1];
}

export function xMUL(P: Pt, k: bigint, a24: bigint, n: bigint): Pt {
  return ladder(P, k, a24, n)[0];
}
