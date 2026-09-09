import { describe, expect, it } from 'vitest';
import { randomBelow, randomInRange } from './bigint';
import { cryptoRng, getRng, seededRng, setRng, withSeed } from './rng';

/**
 * The seedable generator.
 *
 * This is what makes a run reproducible, so it has to be genuinely
 * deterministic, genuinely different across seeds, and genuinely unbiased --
 * a modulo-biased draw would quietly skew the very parameter (rho's c, ECM's
 * sigma) that decides whether the method succeeds.
 */

describe('seededRng', () => {
  it('is deterministic for a given seed', () => {
    const a = seededRng('abc123');
    const b = seededRng('abc123');
    expect([...a.bytes(64)]).toEqual([...b.bytes(64)]);
  });

  it('differs across seeds', () => {
    const a = [...seededRng('abc123').bytes(32)].join(',');
    const b = [...seededRng('abc124').bytes(32)].join(',');
    expect(a).not.toBe(b);
  });

  it('advances rather than repeating a block', () => {
    const r = seededRng('abc123');
    expect([...r.bytes(16)].join(',')).not.toBe([...r.bytes(16)].join(','));
  });

  it('produces a plausibly uniform byte distribution', () => {
    const counts = new Array(256).fill(0);
    for (const b of seededRng('uniformity').bytes(256 * 200)) counts[b]++;
    // Expected 200 per value; a broken generator collapses to a few values.
    expect(Math.min(...counts)).toBeGreaterThan(120);
    expect(Math.max(...counts)).toBeLessThan(300);
  });
});

describe('withSeed', () => {
  it('makes randomBelow reproducible and restores the previous source', () => {
    const before = getRng();
    const draw = (): string =>
      withSeed('fixed-seed', () => Array.from({ length: 8 }, () => String(randomBelow(1n << 64n))).join(','));
    expect(draw()).toBe(draw());
    expect(getRng()).toBe(before);
  });

  it('restores the previous source even when the body throws', () => {
    const before = getRng();
    expect(() =>
      withSeed('seed', () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(getRng()).toBe(before);
  });

  it('the default source is the cryptographic one', () => {
    expect(getRng()).toBe(cryptoRng);
  });
});

describe('randomBelow', () => {
  it('never returns a value at or above the bound', () => {
    withSeed('bounds', () => {
      for (const bound of [2n, 3n, 5n, 17n, 1000n, (1n << 64n) + 1n]) {
        for (let i = 0; i < 200; i++) {
          const v = randomBelow(bound);
          expect(v).toBeGreaterThanOrEqual(0n);
          expect(v).toBeLessThan(bound);
        }
      }
    });
  });

  it('covers the whole range of a small bound, rather than a biased slice', () => {
    const seen = new Set<string>();
    withSeed('coverage', () => {
      for (let i = 0; i < 400; i++) seen.add(String(randomBelow(5n)));
    });
    expect(seen.size).toBe(5);
  });

  it('randomInRange respects both endpoints', () => {
    const seen = new Set<string>();
    withSeed('range', () => {
      for (let i = 0; i < 400; i++) seen.add(String(randomInRange(10n, 14n)));
    });
    expect([...seen].sort()).toEqual(['10', '11', '12', '13', '14']);
  });

  it('rejects a non-positive bound rather than looping', () => {
    expect(() => randomBelow(0n)).toThrow();
    expect(() => randomBelow(-1n)).toThrow();
  });

  // Deterministic replay must not be the DEFAULT: production draws from
  // crypto.getRandomValues, and a lab that silently shipped a seeded generator
  // would be generating "random" teaching keys from a fixed stream.
  it('production draws differ run to run', () => {
    setRng(cryptoRng);
    const a = Array.from({ length: 8 }, () => String(randomBelow(1n << 64n))).join(',');
    const b = Array.from({ length: 8 }, () => String(randomBelow(1n << 64n))).join(',');
    expect(a).not.toBe(b);
  });
});
