/**
 * Miller-Rabin primality, and prime generators shaped for each weakness the
 * lab teaches.
 *
 * Miller-Rabin is a PROBABILISTIC test, and this lab says so wherever it
 * reports a result. Below 3,317,044,064,679,887,385,961,981 the first
 * thirteen prime bases are a proven-deterministic set (Sorenson & Webster,
 * "Strong pseudoprimes to twelve prime bases", Math. Comp. 2015), so for every
 * N this lab can actually factor in a browser the answer is exact; above it we
 * add random bases and the verdict is stated as probabilistic.
 */

import { bitLength, gcd, modpow, primesBelow, randomInRange } from './bigint';

/** Sorenson-Webster: proven deterministic for n < 3.317e24. */
const DETERMINISTIC_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
const DETERMINISTIC_LIMIT = 3317044064679887385961981n;

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
 * A safe prime p = 2q + 1 with q prime. p-1 = 2q and p+1 = 2(q+1) both have a
 * huge prime factor, which is what makes p-1 and p+1 hopeless against it.
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
 * Returns null when a cofactor above `limit` survives.
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

/** The largest prime factor of n, or null if n has a factor too big to find. */
export function largestPrimeFactor(n: bigint): bigint | null {
  const f = factorSmall(n);
  if (!f) return null;
  return f.reduce((acc, x) => (x.prime > acc ? x.prime : acc), 1n);
}

/** Coprimality helper used by several algorithms' setup checks. */
export function coprime(a: bigint, b: bigint): boolean {
  return gcd(a, b) === 1n;
}
