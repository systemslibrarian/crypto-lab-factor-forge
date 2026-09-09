/**
 * BigInt helpers shared by every factoring module.
 *
 * Native BigInt only — no library. Everything here is exact integer
 * arithmetic; nothing is approximated and nothing is simulated.
 */

import { getRng } from './rng';

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** Modular exponentiation, square-and-multiply. */
export function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/**
 * Modular inverse via the extended Euclidean algorithm.
 * Throws when the inverse does not exist — in a factoring lab a
 * non-invertible element is a RESULT (it carries a factor), so it must never
 * be silently swallowed. ECM catches it deliberately; see `ecm.ts`.
 */
export function modinv(a: bigint, m: bigint): bigint {
  let [old_r, r] = [((a % m) + m) % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('modinv: not invertible');
  return ((old_s % m) + m) % m;
}

/** Number of bits in |n| (bitLength(0) = 0). */
export function bitLength(n: bigint): number {
  let v = abs(n);
  let bits = 0;
  // Chunked so a 2048-bit value is not walked one bit at a time.
  while (v >= 0x100000000n) {
    v >>= 32n;
    bits += 32;
  }
  let w = Number(v);
  while (w > 0) {
    w >>>= 1;
    bits++;
  }
  return bits;
}

/** Floor of the integer square root (Newton). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  // Seed from the bit length so Newton starts close for huge inputs.
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** Ceiling of the integer square root. */
export function isqrtCeil(n: bigint): bigint {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

export function isPerfectSquare(n: bigint): boolean {
  if (n < 0n) return false;
  const r = isqrt(n);
  return r * r === n;
}

/** Floor of the integer k-th root. */
export function iroot(n: bigint, k: number): bigint {
  if (k < 1) throw new Error('iroot: k must be >= 1');
  if (n < 2n) return n;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k) + 1);
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > n) x -= 1n;
  while ((x + 1n) ** K <= n) x += 1n;
  return x;
}

/**
 * If n = b^k for some k >= 2, return {base, exponent}; otherwise null.
 *
 * Detected up front because knowing the shape is cheaper than searching for it,
 * NOT because the search would fail. An earlier version of this comment claimed
 * "rho in particular loops on n = p^2", which is false and was measured to be
 * false: Brent's rho splits p^2 on the first c it tries, because the walk still
 * collides modulo p on the usual sqrt(p) schedule. What differs is the ANSWER --
 * the only nontrivial gcd available is p, so the split is p x p rather than two
 * distinct primes, and the recursion has to be applied to both halves. Peeling
 * the power here makes that structure visible instead of leaving it implicit.
 */
export function perfectPower(n: bigint): { base: bigint; exponent: number } | null {
  if (n < 4n) return null;
  const maxExp = bitLength(n);
  for (let k = 2; k <= maxExp; k++) {
    const r = iroot(n, k);
    if (r < 2n) break;
    if (r ** BigInt(k) === n) return { base: r, exponent: k };
  }
  return null;
}

/** Jacobi symbol (a/n) for odd n > 0. Equals the Legendre symbol for prime n. */
export function jacobi(a: bigint, n: bigint): number {
  if (n <= 0n || (n & 1n) === 0n) throw new Error('jacobi: n must be odd and positive');
  let x = ((a % n) + n) % n;
  let y = n;
  let result = 1;
  while (x !== 0n) {
    while ((x & 1n) === 0n) {
      x >>= 1n;
      const yMod8 = y % 8n;
      if (yMod8 === 3n || yMod8 === 5n) result = -result;
    }
    [x, y] = [y, x];
    if (x % 4n === 3n && y % 4n === 3n) result = -result;
    x %= y;
  }
  return y === 1n ? result : 0;
}

/**
 * Tonelli–Shanks: a square root of a mod an odd prime p, or null if a is a
 * non-residue. Used by the quadratic sieve to find the two sieve roots.
 */
export function sqrtMod(a: bigint, p: bigint): bigint | null {
  const n = ((a % p) + p) % p;
  if (n === 0n) return 0n;
  if (p === 2n) return n & 1n;
  if (jacobi(n, p) !== 1) return null;
  if (p % 4n === 3n) return modpow(n, (p + 1n) / 4n, p);

  let q = p - 1n;
  let s = 0n;
  while ((q & 1n) === 0n) {
    q >>= 1n;
    s += 1n;
  }
  let z = 2n;
  while (jacobi(z, p) !== -1) z += 1n;

  let m = s;
  let c = modpow(z, q, p);
  let t = modpow(n, q, p);
  let r = modpow(n, (q + 1n) / 2n, p);
  while (t !== 1n) {
    let i = 0n;
    let t2 = t;
    while (t2 !== 1n) {
      t2 = (t2 * t2) % p;
      i += 1n;
      if (i === m) return null;
    }
    const b = modpow(c, 1n << (m - i - 1n), p);
    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }
  return r;
}

/**
 * Uniform random BigInt in [0, bound), drawn from the CURRENT random source.
 *
 * That indirection is the whole reason a run can be replayed: production uses
 * `crypto.getRandomValues`, and a seeded run substitutes a deterministic stream
 * without any algorithm knowing the difference. See `rng.ts`.
 *
 * Rejection sampling, not modulo: taking `v % bound` would bias the low values
 * whenever `bound` is not a power of two, which for ECM's sigma and rho's c is a
 * silent bias in exactly the parameter the method's success depends on.
 */
export function randomBelow(bound: bigint): bigint {
  if (bound <= 0n) throw new Error('randomBelow: bound must be positive');
  const bits = bitLength(bound);
  const bytes = Math.ceil(bits / 8);
  for (;;) {
    const buf = getRng().bytes(bytes);
    let v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
    v >>= BigInt(bytes * 8 - bits);
    if (v < bound) return v;
  }
}

/** Uniform random BigInt in [lo, hi]. */
export function randomInRange(lo: bigint, hi: bigint): bigint {
  if (hi < lo) throw new Error('randomInRange: empty range');
  return lo + randomBelow(hi - lo + 1n);
}

/** All primes below `limit`, sieve of Eratosthenes. */
export function primesBelow(limit: number): number[] {
  if (limit < 3) return limit > 2 ? [2] : [];
  const sieve = new Uint8Array(limit);
  const out: number[] = [];
  for (let i = 2; i < limit; i++) {
    if (sieve[i]) continue;
    out.push(i);
    for (let j = i * i; j < limit; j += i) sieve[j] = 1;
  }
  return out;
}
