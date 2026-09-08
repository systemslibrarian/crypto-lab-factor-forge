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
