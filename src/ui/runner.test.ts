import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../factor/types';
import { Runner } from './runner';

/**
 * The Runner, exercised through its FALLBACK path.
 *
 * There is no `Worker` in the Vitest environment, so `ensureWorker()` throws and
 * the Runner degrades to running the algorithms inline — which is exactly the
 * path that had no coverage at all and no user-visible consequence. These tests
 * pin the three behaviours that matter: the queue serialises, cancellation is
 * reported as cancellation rather than as a failure, and a degraded Runner says
 * so instead of pretending nothing changed.
 */

const V = 1640344808434621n; // pinned qs-target vector, 51-bit

describe('the inline fallback is honest about being a fallback', () => {
  it('degrades when no Worker exists, and records why', async () => {
    const r = new Runner();
    expect(r.inlineOnly).toBe(false);
    const res = await r.factor('trial', 15n, DEFAULT_PARAMS, 1000, 'seed');
    expect(res.ok).toBe(true);
    expect(r.inlineOnly).toBe(true);
    expect(r.fallbackReason).toBeTruthy();
    // ...and it reports that cancellation is no longer honest on this path.
    expect(r.cancellable).toBe(false);
  });

  it('still produces a correct, verifiable result', async () => {
    const r = new Runner();
    // 99991 x 1000613679049 -- the pinned small-factor vector, which trial
    // division does reach inside its default bound.
    const n = 100052362381788559n;
    const res = await r.factor('trial', n, DEFAULT_PARAMS, 20_000, 'seed');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.outcome.p).not.toBeNull();
    expect(BigInt(res.outcome.p!) * BigInt(res.outcome.q!)).toBe(n);
  });

  it('reports a give-up as a completed run, not as a failure', async () => {
    const r = new Runner();
    // Both factors are far above the trial bound, so it must give up -- and a
    // give-up is a RESULT about N, so it comes back ok:true with a trace that
    // says where it stopped.
    const res = await r.factor('trial', V, DEFAULT_PARAMS, 20_000, 'seed');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.outcome.p).toBeNull();
    expect(res.outcome.trace.gaveUp).not.toBeNull();
  });
});

describe('cancellation is not a failure', () => {
  it('a job still QUEUED when cancel lands reports "cancelled", not an error', async () => {
    const r = new Runner();
    // Two jobs behind a slow one. Cancel while they are queued: they must come
    // back as cancellations, which is a different thing from a failure and has
    // to stay distinguishable -- conflating the two is what made a genuine
    // worker crash look like the user pressing Cancel.
    const slow = r.factor('rho', V, { ...DEFAULT_PARAMS, rhoSteps: 40_000_000 }, 20_000, 's0');
    const queued = r.factor('ecm', V, DEFAULT_PARAMS, 20_000, 's1');
    r.cancel();
    const res = await queued;
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.kind).toBe('cancelled');
    await slow;
  });

  it('cancelling drops every job still queued behind the running one', async () => {
    const r = new Runner();
    const a = r.factor('trial', V, DEFAULT_PARAMS, 20_000, 's1');
    const b = r.factor('rho', V, DEFAULT_PARAMS, 20_000, 's2');
    const c = r.factor('ecm', V, DEFAULT_PARAMS, 20_000, 's3');
    r.cancel();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    // The first may already have been running when cancel landed; the ones
    // behind it must not have produced results.
    const cancelled = [ra, rb, rc].filter((x) => !x.ok).length;
    expect(cancelled).toBeGreaterThanOrEqual(2);
    void ra;
    void rb;
    void rc;
  });
});

describe('the queue serialises jobs', () => {
  it('runs jobs one at a time, in order', async () => {
    const r = new Runner();
    const order: string[] = [];
    const jobs = (['trial', 'fermat', 'pminus1'] as const).map((id) =>
      r.factor(id, V, DEFAULT_PARAMS, 20_000, 'seed').then((res) => {
        order.push(id);
        return res;
      })
    );
    await Promise.all(jobs);
    expect(order).toEqual(['trial', 'fermat', 'pminus1']);
  });

  it('one failing job does not poison the queue behind it', async () => {
    const r = new Runner();
    // An N of 0 makes the algorithms throw; the next job must still run.
    const bad = r.factor('qs', 0n, DEFAULT_PARAMS, 1000, 'seed');
    const good = r.factor('trial', 15n, DEFAULT_PARAMS, 1000, 'seed');
    const [b, g] = await Promise.all([bad, good]);
    void b;
    expect(g.ok).toBe(true);
  });
});

describe('seeding', () => {
  /**
   * The seed is what makes a failed search a RESULT rather than an anecdote:
   * "rho gave up" means nothing if the pseudo-random walk it gave up on cannot
   * be recovered. So the seed has to actually determine the walk.
   */
  it('the same seed reproduces the same run, and different seeds do not', async () => {
    const r = new Runner();
    const params = { ...DEFAULT_PARAMS, rhoSteps: 4_000_000 };
    const iterations = async (seed: string): Promise<string> => {
      const res = await r.factor('rho', V, params, 20_000, seed);
      if (!res.ok) throw new Error('expected a completed run');
      return res.outcome.trace.metrics.find((m) => m.key === 'iterations')?.value ?? '';
    };
    const a = await iterations('deadbeefdeadbeefdeadbeefdeadbeef');
    const b = await iterations('deadbeefdeadbeefdeadbeefdeadbeef');
    expect(a).not.toBe('');
    expect(a).toBe(b);

    // Different seeds walk differently. Asserted over several draws rather than
    // one, because two random walks CAN coincidentally take the same number of
    // steps and a single comparison would be flaky.
    const others = await Promise.all(
      ['0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f', '1234567890abcdef1234567890abcdef', 'cafebabecafebabecafebabecafebabe'].map(
        iterations
      )
    );
    expect(new Set([a, ...others]).size).toBeGreaterThan(1);
  });
});
