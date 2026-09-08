import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeShape, verifyFactorization } from './verify';
import { EDGE_CASES, VECTORS } from '../factor/vectors';

describe('invariant I1: the verifier is the only thing that blesses a result', () => {
  it('accepts a true factorization of every pinned vector', () => {
    for (const v of VECTORS) {
      const verdict = verifyFactorization({ n: v.n, p: v.p, q: v.q });
      expect(verdict.status).toBe('verified');
      expect(verdict.productMatchesN).toBe(true);
      expect(verdict.fullyFactored).toBe(true);
      expect(verdict.product).toBe(String(v.n));
    }
  });

  it('refutes a factorization that does not multiply back', () => {
    const v = VECTORS[0];
    const verdict = verifyFactorization({ n: v.n, p: v.p, q: v.q + 2n });
    expect(verdict.status).toBe('refuted');
    expect(verdict.productMatchesN).toBe(false);
    expect(verdict.reason).toContain('not N');
  });

  it('refutes the trivial split 1 * N', () => {
    const v = VECTORS[0];
    expect(verifyFactorization({ n: v.n, p: 1n, q: v.n }).status).toBe('refuted');
  });

  it('reports a composite factor as a PARTIAL split, not a factorization', () => {
    // 3 * (5 * 7): the product is right but one side is composite.
    const verdict = verifyFactorization({ n: 105n, p: 3n, q: 35n });
    expect(verdict.status).toBe('verified');
    expect(verdict.productMatchesN).toBe(true);
    expect(verdict.fullyFactored).toBe(false);
    expect(verdict.reason).toContain('partial split');
  });

  it('returns no-claim when nothing was found', () => {
    const verdict = verifyFactorization({ n: 105n, p: null, q: null });
    expect(verdict.status).toBe('no-claim');
    expect(verdict.factors).toEqual([]);
  });

  it('records whether Miller-Rabin was deterministic for the factor size', () => {
    const v = VECTORS[0];
    const verdict = verifyFactorization({ n: v.n, p: v.p, q: v.q });
    expect(verdict.factors.every((f) => f.deterministic)).toBe(true);
  });
});

describe('the verifier imports no algorithm module', () => {
  it('has no import of any factoring implementation', () => {
    const src = readFileSync(new URL('./verify.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual(['../factor/bigint', '../factor/primality']);
    for (const banned of ['trial', 'fermat', 'rho', 'pminus1', 'pplus1', 'ecm', 'qs', 'registry', 'tree']) {
      expect(imports.some((i) => i.includes(banned))).toBe(false);
    }
  });
});

describe('shape of N — the edge cases', () => {
  it('names a prime N and refuses to pretend there is a factorization', () => {
    const shape = describeShape(EDGE_CASES.prime);
    expect(shape.prime).toBe(true);
    expect(shape.degenerate).toContain('nothing to factor');
  });

  it('detects a perfect power', () => {
    const shape = describeShape(EDGE_CASES.perfectPower);
    expect(shape.perfectPower).toEqual({ base: '1000003', exponent: 2 });
  });

  it('detects an even N', () => {
    expect(describeShape(EDGE_CASES.even).even).toBe(true);
  });

  it('rejects N below 2', () => {
    expect(describeShape(EDGE_CASES.one).degenerate).toContain('at least 2');
  });

  it('leaves an ordinary semiprime with no degenerate note', () => {
    const shape = describeShape(VECTORS[0].n);
    expect(shape.degenerate).toBeNull();
    expect(shape.prime).toBe(false);
    expect(shape.perfectPower).toBeNull();
  });
});
