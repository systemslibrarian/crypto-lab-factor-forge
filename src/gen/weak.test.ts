import { describe, expect, it } from 'vitest';
import { largestPrimeFactor } from '../factor/primality';
import { REGISTRY } from '../factor/registry';
import { factorTree, treeLeaves } from '../factor/tree';
import { DEFAULT_PARAMS } from '../factor/types';
import { EDGE_CASES } from '../factor/vectors';
import { generateWeakN, WEAKNESSES } from './weak';
import { verifyFactorization } from '../verify/verify';

/**
 * Invariant I4: a generated N is only returned once the targeted algorithm has
 * really factored it and at least one other has really failed. These tests
 * re-run both halves independently of the generator's own proof.
 */
describe('I4: the weak-N generator proves what it claims', () => {
  for (const spec of WEAKNESSES) {
    it(`${spec.target}: the targeted method wins and the others lose`, () => {
      const gen = generateWeakN(spec.target, { bits: 56, proofMs: 4000 });
      expect(gen.p * gen.q).toBe(gen.n);
      expect(verifyFactorization({ n: gen.n, p: gen.p, q: gen.q }).fullyFactored).toBe(true);

      if (spec.targeted) {
        const out = REGISTRY[spec.targeted](gen.n, DEFAULT_PARAMS, { maxMs: 8000 });
        expect(verifyFactorization({ n: gen.n, p: out.p, q: out.q }).status).toBe('verified');
      }
      for (const id of spec.mustResist) {
        const out = REGISTRY[id](gen.n, DEFAULT_PARAMS, { maxMs: 8000 });
        expect(out.p, `${id} should have failed on the ${spec.target} shape`).toBeNull();
        expect(out.trace.gaveUp).not.toBeNull();
      }
      expect(gen.proof.resisted.every((r) => r.failed)).toBe(true);
    });
  }

  it('the "none" target really has no smoothness or gap to exploit', () => {
    const gen = generateWeakN('none', { bits: 56, proofMs: 4000 });
    const B = BigInt(DEFAULT_PARAMS.smoothBound);
    for (const v of [gen.p - 1n, gen.p + 1n, gen.q - 1n, gen.q + 1n]) {
      const l = largestPrimeFactor(v);
      expect(l === null || l > B).toBe(true);
    }
  });

  it('the evidence it reports is recomputable', () => {
    const gen = generateWeakN('smooth-pminus1', { bits: 56, proofMs: 4000 });
    const gap = gen.evidence.find((e) => e.key === '|p - q|')!.value;
    const diff = gen.q > gen.p ? gen.q - gen.p : gen.p - gen.q;
    expect(BigInt(gap)).toBe(diff);
    const lp = gen.evidence.find((e) => e.key === 'largest prime of p - 1')!.value;
    expect(lp).toBe(String(largestPrimeFactor(gen.p - 1n)));
  });
});

describe('recursive factorization for N with three or more factors', () => {
  it('splits a three-prime N down to primes that multiply back', () => {
    const tree = factorTree(EDGE_CASES.threeFactors, DEFAULT_PARAMS, { maxMs: 10_000 });
    const leaves = treeLeaves(tree);
    expect(leaves.length).toBe(3);
    expect(leaves.reduce((acc, v) => acc * BigInt(v), 1n)).toBe(EDGE_CASES.threeFactors);
    expect(tree.stuck).toBeNull();
  });

  it('handles a perfect power without stalling', () => {
    const tree = factorTree(EDGE_CASES.perfectPower, DEFAULT_PARAMS, { maxMs: 10_000 });
    expect(treeLeaves(tree)).toEqual(['1000003', '1000003']);
  });

  it('returns a prime as a leaf, not as a failure', () => {
    const tree = factorTree(EDGE_CASES.prime, DEFAULT_PARAMS, { maxMs: 5000 });
    expect(tree.prime).toBe(true);
    expect(tree.children).toEqual([]);
    expect(tree.stuck).toBeNull();
  });
});
