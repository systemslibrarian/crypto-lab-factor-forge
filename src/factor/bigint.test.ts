import { describe, expect, it } from 'vitest';
import {
  bitLength,
  gcd,
  iroot,
  isqrt,
  isqrtCeil,
  jacobi,
  modinv,
  modpow,
  perfectPower,
  primesBelow,
  randomInRange,
  sqrtMod,
} from './bigint';

describe('integer roots', () => {
  it('isqrt is the exact floor', () => {
    for (const n of [0n, 1n, 2n, 3n, 4n, 99n, 100n, 101n, 10n ** 40n, 10n ** 40n - 1n]) {
      const r = isqrt(n);
      expect(r * r <= n).toBe(true);
      expect((r + 1n) * (r + 1n) > n).toBe(true);
    }
  });

  it('isqrtCeil is the exact ceiling', () => {
    expect(isqrtCeil(16n)).toBe(4n);
    expect(isqrtCeil(17n)).toBe(5n);
  });

  it('iroot is the exact floor k-th root', () => {
    expect(iroot(1000n, 3)).toBe(10n);
    expect(iroot(999n, 3)).toBe(9n);
    expect(iroot(2n ** 61n, 61)).toBe(2n);
  });

  it('perfectPower finds the base and rejects non-powers', () => {
    expect(perfectPower(1000003n ** 2n)).toEqual({ base: 1000003n, exponent: 2 });
    expect(perfectPower(2n ** 17n)).toEqual({ base: 2n, exponent: 17 });
    expect(perfectPower(15n)).toBeNull();
    expect(perfectPower(1640344808434621n)).toBeNull();
  });
});

describe('modular arithmetic', () => {
  it('modpow agrees with repeated multiplication on small inputs', () => {
    const m = 1009n;
    for (let b = 2n; b < 12n; b++) {
      let acc = 1n;
      for (let e = 0n; e < 40n; e++) {
        expect(modpow(b, e, m)).toBe(acc);
        acc = (acc * b) % m;
      }
    }
  });

  it('modinv inverts, and throws on a zero divisor', () => {
    const m = 1000003n;
    for (const a of [2n, 3n, 12345n, 999999n]) {
      expect((a * modinv(a, m)) % m).toBe(1n);
    }
    expect(() => modinv(6n, 9n)).toThrow();
  });

  it('gcd matches the naive divisor search on small inputs', () => {
    for (let a = 1n; a <= 40n; a++) {
      for (let b = 1n; b <= 40n; b++) {
        let want = 1n;
        for (let d = 1n; d <= a && d <= b; d++) if (a % d === 0n && b % d === 0n) want = d;
        expect(gcd(a, b)).toBe(want);
      }
    }
  });
});

describe('quadratic residues', () => {
  it('jacobi equals the Legendre symbol counted by brute force, for primes', () => {
    for (const p of [7n, 11n, 13n, 17n, 101n]) {
      const squares = new Set<bigint>();
      for (let x = 1n; x < p; x++) squares.add((x * x) % p);
      for (let a = 1n; a < p; a++) {
        expect(jacobi(a, p)).toBe(squares.has(a) ? 1 : -1);
      }
    }
  });

  it('sqrtMod returns a real square root, or null for a non-residue', () => {
    for (const p of [7n, 13n, 17n, 97n, 1000003n]) {
      for (let i = 0; i < 20; i++) {
        const a = randomInRange(1n, p - 1n);
        const r = sqrtMod(a, p);
        if (r === null) expect(jacobi(a, p)).toBe(-1);
        else expect((r * r) % p).toBe(a % p);
      }
    }
  });

  it('sqrtMod handles p = 1 mod 8, the Tonelli-Shanks loop branch', () => {
    const p = 41n; // 41 = 1 mod 8
    const r = sqrtMod(10n, p);
    expect(r).not.toBeNull();
    expect((r! * r!) % p).toBe(10n);
  });
});

describe('sieve and bit length', () => {
  it('primesBelow matches a naive trial-division sieve', () => {
    const naive: number[] = [];
    for (let n = 2; n < 500; n++) {
      let isP = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) isP = false;
      if (isP) naive.push(n);
    }
    expect(primesBelow(500)).toEqual(naive);
  });

  it('bitLength matches the binary string length', () => {
    for (const n of [1n, 2n, 255n, 256n, 2n ** 64n, 2n ** 127n - 1n]) {
      expect(bitLength(n)).toBe(n.toString(2).length);
    }
    expect(bitLength(0n)).toBe(0);
  });
});
