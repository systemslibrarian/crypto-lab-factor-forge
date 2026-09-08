/**
 * The "generate a weak N" forge — the teaching core.
 *
 * Each target builds an N that falls to exactly the method whose structural
 * assumption it satisfies. Invariant I4 is enforced HERE, at generation time:
 * a candidate is only returned once the targeted algorithm has actually
 * factored it and at least one other algorithm has actually failed inside its
 * cap. Nothing is claimed on the strength of how the primes were built.
 */

import { bitLength, isqrtCeil } from '../factor/bigint';
import {
  largestPrimeFactor,
  nextPrime,
  randomPrime,
  safePrime,
  smoothMinusOnePrime,
  smoothPlusOnePrime,
} from '../factor/primality';
import { REGISTRY } from '../factor/registry';
import { DEFAULT_PARAMS, type AlgorithmId, type Params } from '../factor/types';
import { verifyFactorization } from '../verify/verify';

export type WeaknessTarget =
  | 'small-factor'
  | 'close-primes'
  | 'smooth-pminus1'
  | 'smooth-pplus1'
  | 'none';

export interface WeaknessSpec {
  target: WeaknessTarget;
  label: string;
  /** The method the shape is built for; null for the 'none' target. */
  targeted: AlgorithmId | null;
  /** Methods that must FAIL for the demonstration to mean anything. */
  mustResist: AlgorithmId[];
  blurb: string;
  /** The RSA key-generation rule this shape violates (or, for 'none', obeys). */
  rule: string;
}

export const WEAKNESSES: WeaknessSpec[] = [
  {
    target: 'small-factor',
    label: 'A small factor',
    targeted: 'trial',
    mustResist: ['fermat'],
    blurb: 'One prime small enough to divide by. Trial division ends it immediately.',
    rule: 'Both primes must be the same (large) size.',
  },
  {
    target: 'close-primes',
    label: 'p and q close together',
    targeted: 'fermat',
    mustResist: ['trial', 'pminus1', 'pplus1'],
    blurb: 'q chosen just above p. Fermat starts at ceil(sqrt(N)) and is already almost there.',
    rule: 'Choose p and q independently; |p - q| must be large.',
  },
  {
    target: 'smooth-pminus1',
    label: 'p - 1 is smooth',
    targeted: 'pminus1',
    mustResist: ['trial', 'fermat'],
    blurb: 'p - 1 built entirely from small primes. Pollard p-1 walks straight into it.',
    rule: 'p - 1 must have a large prime factor (a safe prime guarantees it).',
  },
  {
    target: 'smooth-pplus1',
    label: 'p + 1 is smooth',
    targeted: 'pplus1',
    mustResist: ['trial', 'fermat', 'pminus1'],
    blurb: 'p + 1 built from small primes while p - 1 is left rough. Only Williams p+1 sees it.',
    rule: 'p + 1 must have a large prime factor too — a safe prime does NOT guarantee this.',
  },
  {
    target: 'none',
    label: 'No structure at all',
    targeted: null,
    mustResist: ['trial', 'fermat', 'pminus1', 'pplus1'],
    blurb:
      'Two safe primes, far apart, with all four of p-1, p+1, q-1, q+1 rough. Every structure-hunting method fails; only the structure-free ones remain.',
    rule: 'This is what the rules are for — and none of them helps against Shor.',
  },
];

export function weaknessSpec(target: WeaknessTarget): WeaknessSpec {
  const w = WEAKNESSES.find((x) => x.target === target);
  if (!w) throw new Error(`unknown weakness target: ${target}`);
  return w;
}

export interface GeneratedN {
  target: WeaknessTarget;
  n: bigint;
  /** The prime the shape was built around — NOT necessarily the smaller one. */
  p: bigint;
  /** The other prime. */
  q: bigint;
  bits: number;
  /** Computed, not asserted: the numbers that make the claim true. */
  evidence: { key: string; value: string }[];
  /** The I4 check, as it actually ran. */
  proof: {
    targeted: AlgorithmId | null;
    targetedSucceeded: boolean;
    targetedMs: number;
    resisted: { id: AlgorithmId; failed: boolean; reason: string; ms: number }[];
  };
  attempts: number;
}

const SMOOTH_BOUND = 500;

function buildCandidate(target: WeaknessTarget, bits: number): { p: bigint; q: bigint } {
  const half = Math.max(16, Math.floor(bits / 2));
  switch (target) {
    case 'small-factor': {
      const p = randomPrime(16);
      const q = randomPrime(bits - 16);
      return { p, q };
    }
    case 'close-primes': {
      const p = randomPrime(half);
      const q = nextPrime(p + 2n);
      return { p, q };
    }
    case 'smooth-pminus1': {
      const p = smoothMinusOnePrime(half, SMOOTH_BOUND);
      const q = safePrime(half);
      return { p, q };
    }
    case 'smooth-pplus1': {
      const p = smoothPlusOnePrime(half, SMOOTH_BOUND);
      const q = safePrime(half);
      return { p, q };
    }
    case 'none': {
      const p = safePrime(half);
      const q = safePrime(half);
      return { p, q };
    }
  }
}

/**
 * "v has a prime factor above `bound`".
 *
 * A null from `largestPrimeFactor` means the cofactor survived trial division
 * to 5x10^7 — so v certainly HAS a factor above that, which is far above any
 * bound this lab uses. Reading that null as "not rough" was a real bug: it
 * rejected every smooth-p+1 candidate whose p-1 was too hard to factor, which
 * is most of them, and the generator then failed after 40 attempts without
 * ever running a proof.
 */
function rough(v: bigint, bound: number): boolean {
  const l = largestPrimeFactor(v);
  if (l === null) return true;
  return l > BigInt(bound);
}

/** Cheap structural pre-filter, so the expensive I4 proof runs on plausible candidates. */
function plausible(target: WeaknessTarget, p: bigint, q: bigint, params: Params): boolean {
  if (p === q) return false;
  const B = params.smoothBound;
  switch (target) {
    case 'small-factor':
      return p < BigInt(params.trialBound);
    case 'close-primes':
      return q - p < 1000n;
    case 'smooth-pminus1':
      return !rough(p - 1n, B) && rough(q - 1n, B) && rough(p + 1n, B);
    case 'smooth-pplus1':
      return !rough(p + 1n, B) && rough(p - 1n, B) && rough(q + 1n, B) && rough(q - 1n, B);
    case 'none':
      return (
        rough(p - 1n, B) &&
        rough(p + 1n, B) &&
        rough(q - 1n, B) &&
        rough(q + 1n, B) &&
        // The exact condition Fermat's cap encodes, rather than a fixed gap:
        // the walk from ceil(sqrt(N)) is (p+q)/2 - ceil(sqrt(N)) steps long.
        (p + q) / 2n - isqrtCeil(p * q) > BigInt(params.fermatSteps)
      );
  }
}

function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

function evidenceFor(target: WeaknessTarget, p: bigint, q: bigint): { key: string; value: string }[] {
  const ev: { key: string; value: string }[] = [
    { key: 'p', value: String(p) },
    { key: 'q', value: String(q) },
    { key: '|p - q|', value: String(absDiff(p, q)) },
  ];
  const lp1 = largestPrimeFactor(p - 1n);
  const lpp1 = largestPrimeFactor(p + 1n);
  const lq1 = largestPrimeFactor(q - 1n);
  const lqp1 = largestPrimeFactor(q + 1n);
  ev.push({ key: 'largest prime of p - 1', value: lp1 === null ? 'too large to factor here' : String(lp1) });
  ev.push({ key: 'largest prime of p + 1', value: lpp1 === null ? 'too large to factor here' : String(lpp1) });
  ev.push({ key: 'largest prime of q - 1', value: lq1 === null ? 'too large to factor here' : String(lq1) });
  ev.push({ key: 'largest prime of q + 1', value: lqp1 === null ? 'too large to factor here' : String(lqp1) });
  if (target === 'small-factor') ev.push({ key: 'smaller prime bits', value: String(bitLength(p)) });
  return ev;
}

export interface GenerateOptions {
  bits?: number;
  params?: Params;
  /** Per-algorithm cap used by the I4 proof. */
  proofMs?: number;
  maxAttempts?: number;
}

/**
 * Build an N for the given weakness and PROVE it before returning (I4).
 * Throws if no candidate proved out within `maxAttempts` — it never returns an
 * unproven N.
 */
export function generateWeakN(target: WeaknessTarget, opts: GenerateOptions = {}): GeneratedN {
  const bits = opts.bits ?? 60;
  const params = opts.params ?? DEFAULT_PARAMS;
  const proofMs = opts.proofMs ?? 4000;
  const maxAttempts = opts.maxAttempts ?? 80;
  const spec = weaknessSpec(target);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // `p` is deliberately NOT re-sorted to be the smaller factor: it is the
    // prime the shape was built around, and every structural check below asks
    // about that specific prime. Sorting them silently pointed the smoothness
    // checks at the wrong factor half the time.
    const { p, q } = buildCandidate(target, bits);
    if (!plausible(target, p, q, params)) continue;
    const n = p * q;

    let targetedSucceeded = true;
    let targetedMs = 0;
    if (spec.targeted) {
      const out = REGISTRY[spec.targeted](n, params, { maxMs: proofMs });
      const v = verifyFactorization({ n, p: out.p, q: out.q });
      targetedSucceeded = v.status === 'verified' && v.fullyFactored;
      targetedMs = out.ms;
      if (!targetedSucceeded) continue;
    }

    const resisted = spec.mustResist.map((id) => {
      const out = REGISTRY[id](n, params, { maxMs: proofMs });
      const v = verifyFactorization({ n, p: out.p, q: out.q });
      return {
        id,
        failed: v.status !== 'verified',
        reason: out.trace.gaveUp?.reason ?? 'unexpectedly succeeded',
        ms: out.ms,
      };
    });
    if (!resisted.every((r) => r.failed)) continue;

    return {
      target,
      n,
      p,
      q,
      bits: bitLength(n),
      evidence: evidenceFor(target, p, q),
      proof: { targeted: spec.targeted, targetedSucceeded, targetedMs, resisted },
      attempts: attempt,
    };
  }
  throw new Error(
    `generateWeakN(${target}): no candidate satisfied the I4 proof in ${maxAttempts} attempts`
  );
}
