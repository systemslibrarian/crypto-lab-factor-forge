/**
 * Worker message protocol. BigInts cross the boundary as decimal strings so
 * nothing depends on structured-clone support for BigInt.
 */

import type { AlgorithmId, FactorTrace, Params } from '../factor/types';
import type { WeaknessTarget } from '../gen/weak';
import type { TreeNode } from '../factor/tree';
import type { CorpusContext } from '../corpus/generate';
import type { Verdict } from '../verify/verify';

export type CorpusRequest =
  | ({kind:'corpus'; operation:'generate';jobId:number} & CorpusContext)
  | {kind:'corpus';operation:'batch'|'naive';jobId:number;moduli:string[]};
export interface CorpusProgress {kind:'corpus-progress';jobId:number;stage:'generate'|'product'|'remainder';done:number;total:number;note:string;level?:number;bitLengths?:number[]}
export interface SerializedCorpus {keys:{n:string;rp:number;rq:number}[];distinctSeeds:number;rejectedEqual:number;observedSeedPairs:number;ms:number}
export interface SerializedCorpusAttack {
  splits:{raw:string;factor:string|null;repeated:number[];sharedWith:number[];fallback:boolean}[];
  verdicts:Verdict[]; products:number[][];remainders:number[][];ms:number;comparisons:number|null;
}

export interface SerializedOutcome {
  algorithm: AlgorithmId;
  p: string | null;
  q: string | null;
  ms: number;
  trace: FactorTrace;
}

export type WorkerRequest =
  | CorpusRequest
  | {
      kind: 'factor';
      jobId: number;
      algorithm: AlgorithmId;
      n: string;
      params: Params;
      maxMs: number;
      /** The worker is a separate module instance, so the seed has to travel. */
      seed: string;
    }
  | { kind: 'generate'; jobId: number; target: WeaknessTarget; bits: number; params: Params; seed: string }
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
  | CorpusProgress
  | {kind:'corpus-generated';jobId:number;result:SerializedCorpus}
  | {kind:'corpus-attacked';jobId:number;result:SerializedCorpusAttack}
  | { kind: 'progress'; jobId: number; algorithm: AlgorithmId; done: number; total: number; note: string }
  | { kind: 'factored'; jobId: number; outcome: SerializedOutcome }
  | { kind: 'generated'; jobId: number; result: SerializedGenerated }
  | { kind: 'tree'; jobId: number; root: TreeNode; ms: number }
  | { kind: 'failed'; jobId: number; message: string };
