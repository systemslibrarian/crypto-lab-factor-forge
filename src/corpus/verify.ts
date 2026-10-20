import { verifyFactorization, type Verdict } from '../verify/verify';
import type { CorpusSplit } from './batchgcd';
/** Nothing is rendered as recovered before the existing independent verifier. */
export function verifyCorpus(ns:bigint[],splits:CorpusSplit[]):Verdict[] {
  return splits.map((split,i)=>verifyFactorization({n:ns[i],p:split.factor,q:split.factor===null?null:ns[i]/split.factor}));
}
