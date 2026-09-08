/**
 * Trial division — the baseline.
 *
 * Cost is linear in the SMALLEST factor, which is why it is useless against a
 * balanced RSA modulus and instantaneous against a modulus that accidentally
 * kept a small prime. "Use two primes of equal size" is, among other things,
 * the rule that defends against this.
 */

import { primesBelow } from './bigint';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep } from './types';

export function factorTrial(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  const primes = primesBelow(params.trialBound + 1);
  let divisions = 0;

  steps.push({
    label: 'Build the trial list',
    detail: `Sieve every prime up to B = ${params.trialBound.toLocaleString()} and divide N by each in turn.`,
    values: [
      { key: 'primes to try', value: primes.length.toLocaleString() },
      { key: 'largest', value: String(primes[primes.length - 1] ?? 0) },
    ],
  });

  for (let i = 0; i < primes.length; i++) {
    const d = BigInt(primes[i]);
    if (d * d > n) break;
    divisions++;
    if ((divisions & 0x3ff) === 0) {
      if (budget.cancelled?.()) {
        return gaveUp('trial', steps, metrics(divisions, primes.length), 'cancelled', `${divisions} divisions`, performance.now() - t0);
      }
      if (performance.now() - t0 > budget.maxMs) {
        return gaveUp('trial', steps, metrics(divisions, primes.length), 'time cap reached', `${divisions} divisions`, performance.now() - t0);
      }
      budget.onProgress?.(i, primes.length, `dividing by ${d}`);
    }
    if (n % d === 0n) {
      const q = n / d;
      steps.push({
        label: 'Remainder zero',
        detail: `N mod ${d} = 0 after ${divisions.toLocaleString()} divisions. That single division IS the factorization.`,
        values: [
          { key: 'p', value: String(d) },
          { key: 'q = N / p', value: String(q) },
        ],
        pivotal: true,
      });
      return {
        p: d,
        q,
        ms: performance.now() - t0,
        trace: {
          algorithm: 'trial',
          steps,
          metrics: metrics(divisions, primes.length),
          why: { kind: 'small-factor', factor: String(d), divisions },
          gaveUp: null,
        },
      };
    }
  }

  steps.push({
    label: 'Exhausted the list',
    detail: `No prime up to ${params.trialBound.toLocaleString()} divides N. Every factor of N is larger than that — which is all this method can tell you.`,
  });
  return gaveUp(
    'trial',
    steps,
    metrics(divisions, primes.length),
    `no factor below B = ${params.trialBound.toLocaleString()}`,
    `${divisions.toLocaleString()} divisions`,
    performance.now() - t0
  );
}

function metrics(divisions: number, listed: number): { key: string; value: string }[] {
  return [
    { key: 'divisions', value: divisions.toLocaleString() },
    { key: 'primes in list', value: listed.toLocaleString() },
  ];
}
