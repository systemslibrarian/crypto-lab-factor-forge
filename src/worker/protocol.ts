/**
 * Worker message protocol. BigInts cross the boundary as decimal strings so
 * nothing depends on structured-clone support for BigInt.
 */

import type { AlgorithmId, FactorTrace, Params } from '../factor/types';
import type { WeaknessTarget } from '../gen/weak';
import type { TreeNode } from '../factor/tree';

export interface SerializedOutcome {
  algorithm: AlgorithmId;
  p: string | null;
  q: string | null;
  ms: number;
  trace: FactorTrace;
}

export type WorkerRequest =
  | { kind: 'factor'; jobId: number; algorithm: AlgorithmId; n: string; params: Params; maxMs: number }
  | { kind: 'generate'; jobId: number; target: WeaknessTarget; bits: number; params: Params }
  | { kind: 'tree'; jobId: number; n: string; params: Params; maxMs: number };

export interface SerializedGenerated {
  target: WeaknessTarget;
  n: string;
  p: string;
  q: string;
  bits: number;
  evidence: { key: string; value: string }[];
  proof: {
    targeted: AlgorithmId | null;
    targetedSucceeded: boolean;
    targetedMs: number;
    resisted: { id: AlgorithmId; failed: boolean; reason: string; ms: number }[];
  };
  attempts: number;
}

export type WorkerResponse =
  | { kind: 'progress'; jobId: number; algorithm: AlgorithmId; done: number; total: number; note: string }
  | { kind: 'factored'; jobId: number; outcome: SerializedOutcome }
  | { kind: 'generated'; jobId: number; result: SerializedGenerated }
  | { kind: 'tree'; jobId: number; root: TreeNode; ms: number }
  | { kind: 'failed'; jobId: number; message: string };
