import { describe, expect, it } from 'vitest';
import { primesBelow } from './bigint';
import {
  factorSmall,
  isProbablePrime,
  largestPrimeFactor,
  millerRabin,
  nextPrime,
  randomPrime,
  safePrime,
  smoothMinusOnePrime,
  smoothPlusOnePrime,
} from './primality';

describe('Miller-Rabin', () => {
  it('agrees with a sieve on every n below 5000', () => {
    const primes = new Set(primesBelow(5000));
    for (let n = 2; n < 5000; n++) {
      expect(isProbablePrime(BigInt(n))).toBe(primes.has(n));
    }
  });

  it('rejects the Carmichael numbers that fool Fermat', () => {
    for (const c of [561n, 1105n, 1729n, 2465n, 2821n, 6601n, 8911n]) {
      expect(isProbablePrime(c)).toBe(false);
    }
  });

  it('rejects strong pseudoprimes to the first few bases', () => {
    // 3215031751 is a strong pseudoprime to bases 2, 3, 5 and 7 at once.
    expect(isProbablePrime(3215031751n)).toBe(false);
  });

  it('marks the deterministic range as deterministic and beyond it as not', () => {
    expect(millerRabin(1000003n).deterministic).toBe(true);
    expect(millerRabin(2n ** 200n + 235n).deterministic).toBe(false);
  });
});

describe('prime generators', () => {
  it('randomPrime returns a prime of exactly the requested bit length', () => {
    for (const bits of [16, 24, 32]) {
      const p = randomPrime(bits);
      expect(p.toString(2).length).toBe(bits);
      expect(isProbablePrime(p)).toBe(true);
    }
  });

  it('nextPrime returns the next prime at or above n', () => {
    expect(nextPrime(100n)).toBe(101n);
    expect(nextPrime(101n)).toBe(101n);
    expect(nextPrime(90n)).toBe(97n);
  });

  it('safePrime returns p = 2q + 1 with q prime', () => {
    const p = safePrime(24);
    expect(isProbablePrime(p)).toBe(true);
    expect(isProbablePrime((p - 1n) / 2n)).toBe(true);
  });

  it('smoothMinusOnePrime really has a smooth p - 1', () => {
    const p = smoothMinusOnePrime(30, 200);
    expect(isProbablePrime(p)).toBe(true);
    expect(largestPrimeFactor(p - 1n)!).toBeLessThanOrEqual(200n);
  });

  it('smoothPlusOnePrime really has a smooth p + 1', () => {
    const p = smoothPlusOnePrime(30, 200);
    expect(isProbablePrime(p)).toBe(true);
    expect(largestPrimeFactor(p + 1n)!).toBeLessThanOrEqual(200n);
  });
});

describe('factorSmall', () => {
  it('multiplies back to the input', () => {
    for (const n of [2n, 12n, 97n, 1000000n, 604086478n, 2n ** 20n * 3n * 5n]) {
      const f = factorSmall(n)!;
      const product = f.reduce((acc, x) => acc * x.prime ** BigInt(x.exponent), 1n);
      expect(product).toBe(n);
      for (const x of f) expect(isProbablePrime(x.prime)).toBe(true);
    }
  });

  it('returns null rather than guessing when a large composite cofactor survives', () => {
    const hard = 12051279001098882647n * 2339221235378138320579711727n;
    expect(factorSmall(hard, 1000)).toBeNull();
  });
});
