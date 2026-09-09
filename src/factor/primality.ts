/**
 * Miller-Rabin primality, and prime generators shaped for each weakness the
 * lab teaches.
 *
 * Miller-Rabin is a PROBABILISTIC test, and this lab says so wherever it
 * reports a result. Below psi_13 = 3,317,044,064,679,887,385,961,981 the first
 * thirteen prime bases are a proven-deterministic set (Sorenson & Webster,
 * "Strong pseudoprimes to twelve prime bases", Math. Comp. 84 (2015) 2483-2496,
 * which computes psi_12 and psi_13), so for every N this lab can actually factor
 * in a browser the answer is exact; above it we add random bases and the verdict
 * is stated as probabilistic. The base COUNT and the limit are two halves of one
 * theorem and must be changed together -- see DETERMINISTIC_BASES.
 */

import { bitLength, gcd, modpow, primesBelow, randomInRange } from './bigint';

/**
 * Sorenson-Webster: the first THIRTEEN prime bases are proven deterministic below
 * psi_13 = 3,317,044,064,679,887,385,961,981.
 *
 * Count them. 41n is load-bearing and was missing here once: with only the first
 * twelve bases the proven bound is psi_12 = 318,665,857,834,031,151,167,461, and
 * psi_12 itself is composite -- so `millerRabin(psi_12)` returned
 * {prime: true, deterministic: true} and the verifier certified a composite as a
 * prime factor, claiming the answer was proven while doing it. That is invariant
 * I1 failing at the root, and it is silent: every ordinary input still agrees.
 * `primality.test.ts` pins BOTH psi values so the pairing cannot drift again.
 */
const DETERMINISTIC_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
const DETERMINISTIC_LIMIT = 3317044064679887385961981n;

/**
 * The smallest composite that is a strong pseudoprime to all of the first k prime
 * bases, for k = 1..13 (Jaeschke 1993; Sorenson & Webster 2015). PSI[k] is the
 * exact point at which k bases stop being enough, so PSI[DETERMINISTIC_BASES.length]
 * must equal DETERMINISTIC_LIMIT -- asserted in the tests rather than trusted.
 */
export const PSI: Record<number, bigint> = {
  12: 318665857834031151167461n,
  13: 3317044064679887385961981n,
};

const SMALL_PRIMES = primesBelow(1000).map(BigInt);

export interface PrimalityVerdict {
  prime: boolean;
  /** true when the answer rests on the proven-deterministic base set. */
  deterministic: boolean;
  bases: number;
}

export function millerRabin(n: bigint, extraRounds = 16): PrimalityVerdict {
  if (n < 2n) return { prime: false, deterministic: true, bases: 0 };
  for (const p of SMALL_PRIMES) {
    if (n === p) return { prime: true, deterministic: true, bases: 0 };
    if (n % p === 0n) return { prime: false, deterministic: true, bases: 0 };
  }

  let d = n - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r += 1n;
  }

  const witness = (a: bigint): boolean => {
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) return false;
    for (let i = 1n; i < r; i++) {
      x = (x * x) % n;
      if (x === n - 1n) return false;
    }
    return true;
  };

  const deterministic = n < DETERMINISTIC_LIMIT;
  const bases = [...DETERMINISTIC_BASES];
  if (!deterministic) {
    for (let i = 0; i < extraRounds; i++) bases.push(randomInRange(2n, n - 2n));
  }
  for (const a of bases) {
    if (a % n === 0n) continue;
    if (witness(a)) return { prime: false, deterministic, bases: bases.length };
  }
  return { prime: true, deterministic, bases: bases.length };
}

export function isProbablePrime(n: bigint): boolean {
  return millerRabin(n).prime;
}

/** The next probable prime >= n. */
export function nextPrime(n: bigint): bigint {
  let c = n <= 2n ? 2n : n | 1n;
  if (c === 2n) return 2n;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

/** A random probable prime with exactly `bits` bits (top bit set). */
export function randomPrime(bits: number): bigint {
  if (bits < 2) throw new Error('randomPrime: need at least 2 bits');
  const lo = 1n << BigInt(bits - 1);
  const hi = (1n << BigInt(bits)) - 1n;
  for (;;) {
    const c = randomInRange(lo, hi) | 1n | lo;
    if (bitLength(c) !== bits) continue;
    if (isProbablePrime(c)) return c;
  }
}

/**
 * A prime p whose p-1 is B-smooth: build p-1 as a product of primes <= B and
 * test p = product + 1. This is exactly the shape Pollard's p-1 eats.
 */
export function smoothMinusOnePrime(bits: number, smoothBound: number): bigint {
  const pool = primesBelow(smoothBound + 1).map(BigInt);
  const target = 1n << BigInt(bits - 1);
  for (let attempt = 0; attempt < 20000; attempt++) {
    let m = 2n;
    while (m < target) {
      const q = pool[Number(randomInRange(0n, BigInt(pool.length - 1)))];
      m *= q;
    }
    const p = m + 1n;
    if (isProbablePrime(p)) return p;
  }
  throw new Error('smoothMinusOnePrime: no candidate found');
}

/** A prime p whose p+1 is B-smooth — the shape Williams' p+1 eats. */
export function smoothPlusOnePrime(bits: number, smoothBound: number): bigint {
  const pool = primesBelow(smoothBound + 1).map(BigInt);
  const target = 1n << BigInt(bits - 1);
  for (let attempt = 0; attempt < 20000; attempt++) {
    let m = 2n;
    while (m < target) {
      const q = pool[Number(randomInRange(0n, BigInt(pool.length - 1)))];
      m *= q;
    }
    const p = m - 1n;
    if (p > 2n && isProbablePrime(p)) return p;
  }
  throw new Error('smoothPlusOnePrime: no candidate found');
}

/**
 * A safe prime p = 2q + 1 with q prime. This closes ONE side, not both.
 *
 * p - 1 = 2q has the prime factor q, one bit short of p itself, so Pollard p-1
 * would need a smoothness bound of that order and is finished.
 *
 * p + 1 = 2(q + 1) gets no such guarantee. q + 1 is an arbitrary even number:
 * it is B-smooth about as often as any number of its size, which at the sizes
 * this page runs is often enough to matter and at any size is a property you
 * have not controlled. So a safe prime says nothing about Williams p+1.
 *
 * This comment used to claim that p + 1 = 2(q + 1) "also has a huge prime
 * factor", making both methods hopeless. That is false, and it contradicted
 * every other statement in the lab: the Weak N Forge's "p + 1 is smooth" target
 * carries the rule "p + 1 must have a large prime factor too -- a safe prime
 * does NOT guarantee this", and its "no structure at all" target has to sample
 * safe primes and REJECT the ones whose p + 1 turns out smooth (see the
 * `rough(p + 1n, B)` condition in gen/weak.ts). A comment that promises a
 * guarantee the code spends attempts working around is the kind of error that
 * ends up quoted back as a key-generation rule.
 */
export function safePrime(bits: number): bigint {
  for (;;) {
    const q = randomPrime(bits - 1);
    const p = 2n * q + 1n;
    if (bitLength(p) === bits && isProbablePrime(p)) return p;
  }
}

/**
 * Complete factorization of a SMALL integer by trial division. Used only to
 * compute the "why it worked" evidence (invariant I2): the smoothness of p-1,
 * p+1 or a curve order is FACTORED and shown, never asserted.
 * Trial division runs to `limit`; a cofactor that survives it is kept only if
 * Miller-Rabin says it is prime. Returns null when that cofactor is composite,
 * because the factorization would then be incomplete and every claim resting on
 * it -- "the largest prime factor of p - 1 is X" -- would be wrong rather than
 * merely unknown.
 */
export function factorSmall(
  n: bigint,
  limit = 50_000_000
): { prime: bigint; exponent: number }[] | null {
  if (n < 1n) return null;
  const out: { prime: bigint; exponent: number }[] = [];
  let m = n;
  for (let d = 2n; d * d <= m; d = d === 2n ? 3n : d + 2n) {
    if (d > BigInt(limit)) break;
    if (m % d === 0n) {
      let e = 0;
      while (m % d === 0n) {
        m /= d;
        e++;
      }
      out.push({ prime: d, exponent: e });
    }
  }
  if (m > 1n) {
    if (isProbablePrime(m)) out.push({ prime: m, exponent: 1 });
    else return null;
  }
  return out;
}

/** The largest prime factor of n, or null when `factorSmall` could not finish. */
export function largestPrimeFactor(n: bigint): bigint | null {
  const f = factorSmall(n);
  if (!f) return null;
  return f.reduce((acc, x) => (x.prime > acc ? x.prime : acc), 1n);
}

/** Coprimality helper used by several algorithms' setup checks. */
export function coprime(a: bigint, b: bigint): boolean {
  return gcd(a, b) === 1n;
}
