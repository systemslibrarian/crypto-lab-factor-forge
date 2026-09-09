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

const post = (msg: WorkerResponse): void => {
  (self as unknown as Worker).postMessage(msg);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
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
