/**
 * The long runs live here so a multi-second sieve never freezes the page, and
 * so Cancel can be honest: the UI terminates this worker outright rather than
 * pretending a run stopped while it kept burning the main thread.
 */

import { withSeed } from '../factor/rng';
import { REGISTRY } from '../factor/registry';
import { factorTree } from '../factor/tree';
import { generateWeakN } from '../gen/weak';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { generateCorpus, CORPUS_MAX_KEYS } from '../corpus/generate';
import { batchGcd, pairwiseGcd } from '../corpus/batchgcd';
import { verifyCorpus } from '../corpus/verify';
import { bitLength } from '../factor/bigint';

const post = (msg: WorkerResponse): void => {
  (self as unknown as Worker).postMessage(msg);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if(req.kind==='corpus') {
      const start=performance.now();
      if(req.operation==='generate') {
        if(![256,512,1024].includes(req.bits))throw new Error('Choose 256, 512 or 1024-bit primes.');
        const result=generateCorpus(req,(done,total,note)=>post({kind:'corpus-progress',jobId:req.jobId,stage:'generate',done,total,note}));
        post({kind:'corpus-generated',jobId:req.jobId,result:{...result,keys:result.keys.map(k=>({...k,n:String(k.n)})),ms:performance.now()-start}});
      } else {
        if(req.moduli.length<2||req.moduli.length>CORPUS_MAX_KEYS||req.moduli.some(n=>!/^\d{1,617}$/.test(n)))throw new Error('CORPUS_BUDGET: invalid modulus count or size');
        const ns=req.moduli.map(BigInt);
        const result=req.operation==='batch'?batchGcd(ns,(stage,level,values)=>post({kind:'corpus-progress',jobId:req.jobId,stage,level,bitLengths:values.map(bitLength),done:level,total:Math.ceil(Math.log2(ns.length)),note:`${stage} level ${level}`})):pairwiseGcd(ns);
        const ms=performance.now()-start;
        const verdicts=verifyCorpus(ns,result.splits);
        post({kind:'corpus-attacked',jobId:req.jobId,result:{splits:result.splits.map(s=>({...s,raw:String(s.raw),factor:s.factor===null?null:String(s.factor)})),verdicts,
          products:'products' in result?result.products.map(row=>row.map(bitLength)):[],remainders:'remainders' in result?result.remainders.map(row=>row.map(bitLength)):[],
          ms,comparisons:'comparisons' in result?result.comparisons:null}});
      }
      return;
    }
    if (req.kind === 'factor') {
      const n = BigInt(req.n);
      // Seeded: every random choice this run makes follows from req.seed, so the
      // run record can name a seed that actually reproduces the search.
      const out = withSeed(req.seed, () =>
        REGISTRY[req.algorithm](n, req.params, {
          maxMs: req.maxMs,
          onProgress: (done, total, note) =>
            post({ kind: 'progress', jobId: req.jobId, algorithm: req.algorithm, done, total, note }),
        })
      );
      post({
        kind: 'factored',
        jobId: req.jobId,
        outcome: {
          algorithm: req.algorithm,
          p: out.p === null ? null : String(out.p),
          q: out.q === null ? null : String(out.q),
          ms: out.ms,
          trace: out.trace,
        },
      });
      return;
    }
    if (req.kind === 'generate') {
      const g = withSeed(req.seed, () => generateWeakN(req.target, { bits: req.bits, params: req.params }));
      post({
        kind: 'generated',
        jobId: req.jobId,
        result: {
          target: g.target,
          n: String(g.n),
          p: String(g.p),
          q: String(g.q),
          bits: g.bits,
          evidence: g.evidence,
          proof: g.proof,
          attempts: g.attempts,
        },
      });
      return;
    }
    const t0 = performance.now();
    const root = factorTree(BigInt(req.n), req.params, { maxMs: req.maxMs });
    post({ kind: 'tree', jobId: req.jobId, root, ms: performance.now() - t0 });
  } catch (err) {
    post({ kind: 'failed', jobId: req.jobId, message: err instanceof Error ? err.message : String(err) });
  }
};
