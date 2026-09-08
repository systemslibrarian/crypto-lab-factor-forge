/**
 * Worker client.
 *
 * Cancel terminates the worker and builds a new one — the only way to stop a
 * tight BigInt loop that has already started. If the worker cannot be
 * constructed at all (an environment that blocks module workers), the same
 * calls run inline on the main thread: slower and un-cancellable, but the page
 * still tells the truth instead of silently doing nothing.
 */

import { REGISTRY } from '../factor/registry';
import { factorTree } from '../factor/tree';
import { generateWeakN, type WeaknessTarget } from '../gen/weak';
import type { AlgorithmId, Params } from '../factor/types';
import type {
  SerializedGenerated,
  SerializedOutcome,
  WorkerRequest,
  WorkerResponse,
} from '../worker/protocol';
import type { TreeNode } from '../factor/tree';

/** Omit must distribute over the request union, or every variant loses its own keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<WorkerRequest, 'jobId'>;

type Resolver = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: (done: number, total: number, note: string) => void;
};

export class Runner {
  private worker: Worker | null = null;
  private pending = new Map<number, Resolver>();
  private nextId = 1;
  /** True once worker construction has failed; the fallback path is then used. */
  public inlineOnly = false;

  private ensureWorker(): Worker | null {
    if (this.inlineOnly) return null;
    if (this.worker) return this.worker;
    try {
      // The `new URL(..., import.meta.url)` form is what lets Vite emit the
      // worker as its own chunk and resolve it against the deployed base path,
      // so this keeps working under the GitHub Pages project subpath.
      const w = new Worker(new URL('../worker/factor.worker.ts', import.meta.url), {
        type: 'module',
      });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.dispatch(e.data);
      w.onerror = () => {
        this.inlineOnly = true;
        for (const [, r] of this.pending) r.reject(new Error('worker failed to start'));
        this.pending.clear();
        this.worker = null;
      };
      this.worker = w;
      return w;
    } catch {
      this.inlineOnly = true;
      return null;
    }
  }

  private dispatch(msg: WorkerResponse): void {
    const entry = this.pending.get(msg.jobId);
    if (!entry) return;
    if (msg.kind === 'progress') {
      entry.onProgress?.(msg.done, msg.total, msg.note);
      return;
    }
    this.pending.delete(msg.jobId);
    if (msg.kind === 'failed') entry.reject(new Error(msg.message));
    else entry.resolve(msg);
  }

  /** Stop everything in flight. Rejects each pending call with 'cancelled'. */
  cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, r] of this.pending) r.reject(new Error('cancelled'));
    this.pending.clear();
  }

  private send(req: RequestBody, onProgress?: Resolver['onProgress']): Promise<WorkerResponse> {
    const worker = this.ensureWorker();
    if (!worker) return Promise.reject(new Error('no worker'));
    const jobId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject, onProgress });
      worker.postMessage({ ...req, jobId } as WorkerRequest);
    });
  }

  async factor(
    algorithm: AlgorithmId,
    n: bigint,
    params: Params,
    maxMs: number,
    onProgress?: (done: number, total: number, note: string) => void
  ): Promise<SerializedOutcome> {
    if (!this.inlineOnly) {
      try {
        const res = await this.send({ kind: 'factor', algorithm, n: String(n), params, maxMs }, onProgress);
        if (res.kind === 'factored') return res.outcome;
        throw new Error('unexpected worker response');
      } catch (err) {
        if (err instanceof Error && err.message === 'cancelled') throw err;
        this.inlineOnly = true;
      }
    }
    const out = REGISTRY[algorithm](n, params, { maxMs });
    return {
      algorithm,
      p: out.p === null ? null : String(out.p),
      q: out.q === null ? null : String(out.q),
      ms: out.ms,
      trace: out.trace,
    };
  }

  async generate(target: WeaknessTarget, bits: number, params: Params): Promise<SerializedGenerated> {
    if (!this.inlineOnly) {
      try {
        const res = await this.send({ kind: 'generate', target, bits, params });
        if (res.kind === 'generated') return res.result;
        throw new Error('unexpected worker response');
      } catch (err) {
        if (err instanceof Error && err.message === 'cancelled') throw err;
        this.inlineOnly = true;
      }
    }
    const g = generateWeakN(target, { bits, params });
    return {
      target: g.target,
      n: String(g.n),
      p: String(g.p),
      q: String(g.q),
      bits: g.bits,
      evidence: g.evidence,
      proof: g.proof,
      attempts: g.attempts,
    };
  }

  async tree(n: bigint, params: Params, maxMs: number): Promise<{ root: TreeNode; ms: number }> {
    if (!this.inlineOnly) {
      try {
        const res = await this.send({ kind: 'tree', n: String(n), params, maxMs });
        if (res.kind === 'tree') return { root: res.root, ms: res.ms };
        throw new Error('unexpected worker response');
      } catch (err) {
        if (err instanceof Error && err.message === 'cancelled') throw err;
        this.inlineOnly = true;
      }
    }
    const t0 = performance.now();
    const root = factorTree(n, params, { maxMs });
    return { root, ms: performance.now() - t0 };
  }
}
