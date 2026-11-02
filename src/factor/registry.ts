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

/**
 * The algorithm ids, as a runtime check rather than a type assertion.
 *
 * The worker receives its request over postMessage, where `algorithm` is a
 * string whatever the type says, and uses it to index REGISTRY and call what
 * comes back. Without this, a name that is not an algorithm either calls
 * undefined or -- worse -- resolves an INHERITED property: `constructor` and
 * `valueOf` are both reachable on a plain object literal. `hasOwnProperty` is
 * what excludes those, so this deliberately does not use `in`.
 *
 * Derived from REGISTRY's own keys, so adding an algorithm cannot leave a
 * second list behind.
 */
export function isAlgorithmId(value: string): value is AlgorithmId {
  return Object.prototype.hasOwnProperty.call(REGISTRY, value);
}

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
