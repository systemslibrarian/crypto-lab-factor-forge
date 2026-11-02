/**
 * The single place the algorithms are wired together. Each module exposes the
 * same `factor(N, params, budget) -> {p, q, trace}` shape, so the race board,
 * the worker and the tests all drive them identically.
 */

import { factorECM } from './ecm';
import { factorFermat } from './fermat';
import { factorPMinus1 } from './pminus1';
import { factorPPlus1 } from './pplus1';
import { factorQS } from './qs';
import { factorRho } from './rho';
import { factorTrial } from './trial';
import type { AlgorithmId, FactorFn } from './types';

export const REGISTRY: Record<AlgorithmId, FactorFn> = {
  trial: factorTrial,
  fermat: factorFermat,
  rho: factorRho,
  pminus1: factorPMinus1,
  pplus1: factorPPlus1,
  ecm: factorECM,
  qs: factorQS,
};

export const ALGORITHM_ORDER: AlgorithmId[] = [
  'trial',
  'fermat',
  'rho',
  'pminus1',
  'pplus1',
  'ecm',
  'qs',
];

export function run(id: AlgorithmId, ...args: Parameters<FactorFn>): ReturnType<FactorFn> {
  return REGISTRY[id](...args);
}

/**
 * Resolve an algorithm NAME, from anywhere untrusted, to the function it names.
 *
 * The worker gets `algorithm` over postMessage, so it is an unchecked string
 * there however it is typed. Two things make this safe, and the second is the
 * one that is easy to get wrong:
 *
 * 1. An unknown name resolves to null rather than to undefined-called-as-a-
 *    function. REGISTRY is a plain object literal, so it also INHERITS callable
 *    properties -- `constructor`, `valueOf`, `toString` and `hasOwnProperty` are
 *    all reachable on it. A membership test written with `in` says yes to every
 *    one of those; the test for this function asserts that, so the mistake
 *    cannot be reintroduced quietly.
 * 2. The value used to index REGISTRY comes out of ALGORITHM_ORDER -- our own
 *    constant -- rather than being the caller's string. Narrowing the caller's
 *    string with a type predicate would satisfy the compiler and still leave
 *    `REGISTRY[caller's string]` as the expression that runs, which is the
 *    shape of the defect rather than its fix.
 *
 * ALGORITHM_ORDER is therefore load-bearing here, and a test pins it against
 * REGISTRY's own keys so a new algorithm cannot be reachable from one and not
 * the other.
 */
export function resolveAlgorithm(name: string): FactorFn | null {
  const id = ALGORITHM_ORDER.find((candidate) => candidate === name);
  return id === undefined ? null : REGISTRY[id];
}
