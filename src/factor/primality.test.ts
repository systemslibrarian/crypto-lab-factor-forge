import { describe, expect, it } from 'vitest';
import { primesBelow } from './bigint';
import {
  factorSmall,
  isProbablePrime,
  largestPrimeFactor,
  millerRabin,
  nextPrime,
  PSI,
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

  /**
   * The base COUNT and the deterministic LIMIT are two halves of one theorem, and
   * nothing else in this suite can tell them apart: every ordinary prime and every
   * ordinary composite agrees under twelve bases and under thirteen. psi_12 is the
   * exact number that does not — it is composite, it is a strong pseudoprime to all
   * twelve of the first twelve prime bases, and it sits BELOW the thirteen-base
   * bound. With base 41 missing, this returned {prime: true, deterministic: true}
   * and the verifier certified a composite as a prime factor while claiming proof.
   */
  it('rejects psi_12, the composite that twelve bases cannot see', () => {
    const v = millerRabin(PSI[12]);
    expect(v.prime).toBe(false);
    expect(PSI[12]).toBeLessThan(3317044064679887385961981n);
    // It really is a strong pseudoprime to the first twelve: every base below 41
    // must fail to expose it, or this test is passing for the wrong reason.
    expect(v.deterministic).toBe(true);
    expect(v.bases).toBe(13);
  });

  it('the deterministic limit is exactly the bound for the base set it ships', () => {
    // psi_k is the smallest composite the first k prime bases all miss, so a set of
    // k bases is proven only BELOW psi_k. If someone adds or removes a base without
    // moving the limit, this fails.
    const v = millerRabin(PSI[13]);
    expect(v.prime).toBe(false);
    // psi_13 is not strictly below the limit, so the verdict is honestly
    // reported as probabilistic rather than proven.
    expect(v.deterministic).toBe(false);
    expect(millerRabin(PSI[13] - 2n).deterministic).toBe(true);
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
