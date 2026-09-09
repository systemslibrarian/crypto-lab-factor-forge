/**
 * The one interface every algorithm module implements:
 *   factor(N, params, budget) -> FactorOutcome  ({p, q, trace})
 *
 * Nothing in here knows whether a result is TRUE. Deciding that is
 * `src/verify/verify.ts`, which imports no algorithm module (invariant I1).
 */

export type AlgorithmId =
  | 'trial'
  | 'fermat'
  | 'rho'
  | 'pminus1'
  | 'pplus1'
  | 'ecm'
  | 'qs';

/** What an algorithm's cost actually scales with — the axis of the ladder. */
export type CostDriver =
  | 'smallest-factor'
  | 'p-minus-1-smoothness'
  | 'p-plus-1-smoothness'
  | 'curve-order-smoothness'
  | 'p-q-gap'
  | 'size-of-N';

export interface TraceStep {
  /** Short label for the stepper's spine. */
  label: string;
  /** One sentence of plain language about what just happened. */
  detail: string;
  /** Named intermediate values, already stringified for display. */
  values?: { key: string; value: string }[];
  /** Marks the step where the factor actually fell out. */
  pivotal?: boolean;
}

/**
 * The COMPUTED explanation of why an algorithm succeeded (invariant I2).
 * Every field here is derived from the recovered factor, never asserted.
 */
export type WhyEvidence =
  | {
      kind: 'small-factor';
      factor: string;
      /** Divisions performed before the hit. */
      divisions: number;
    }
  | {
      kind: 'p-q-gap';
      gap: string;
      gapBits: number;
      /** a = (p+q)/2, so the search length is a - ceil(sqrt(N)). */
      steps: number;
      sqrtN: string;
    }
  | {
      kind: 'smallest-factor';
      factor: string;
      factorBits: number;
      steps: number;
      /** sqrt(p), the birthday-collision scale rho actually works at. */
      sqrtFactor: string;
    }
  | {
      kind: 'smoothness';
      /** 'p-1' | 'p+1' | 'curve order' — the group whose order was smooth. */
      group: string;
      value: string;
      factorization: { prime: string; exponent: number }[];
      largestPrime: string;
      bound: number;
      /** false when the cofactor was too large to factor, so no claim is made. */
      complete: boolean;
      /**
       * Whether largestPrime <= bound actually holds. Computed here rather than
       * assumed by the sentence that renders it: Williams p+1 used to print
       * "p + 1 = 21998936388, whose largest prime factor is 55021 — under the
       * bound 10,000", which is false, because that run had actually succeeded in
       * the p-1 group. The renderer now reads this flag instead of asserting.
       */
      withinBound: boolean;
    }
  | {
      kind: 'relations';
      factorBaseSize: number;
      relations: number;
      dependencies: number;
      /** How many dependencies produced a trivial gcd before one worked (I5). */
      trivialAttempts: number;
      x: string;
      y: string;
    };

export interface FactorTrace {
  algorithm: AlgorithmId;
  steps: TraceStep[];
  /** Numbers the race board and the ladder chart read. */
  metrics: { key: string; value: string }[];
  /** Present only on success; computed from the recovered factor (I2). */
  why: WhyEvidence | null;
  /** Present only on failure. Never faked into a success (see EDGE CASES). */
  gaveUp: { reason: string; at: string } | null;
}

export interface FactorOutcome {
  /** The smaller recovered factor, or null when the algorithm gave up. */
  p: bigint | null;
  /** N / p, or null. */
  q: bigint | null;
  trace: FactorTrace;
  /** performance.now() delta, real (invariant I3). */
  ms: number;
}

/** Per-algorithm tunables the learner drives from the UI. */
export interface Params {
  /** trial division: highest prime tried. */
  trialBound: number;
  /** Fermat: maximum a-steps above ceil(sqrt(N)). */
  fermatSteps: number;
  /** rho: maximum iterations of f before giving up. */
  rhoSteps: number;
  /** p-1 and p+1: the stage-1 smoothness bound B1. */
  smoothBound: number;
  /** ECM: stage-1 bound. */
  ecmB1: number;
  /** ECM: stage-2 bound (0 disables stage 2). */
  ecmB2: number;
  /** ECM: how many curves to try before giving up. */
  ecmCurves: number;
  /** QS: factor-base bound. */
  qsFactorBaseBound: number;
  /** QS: half-width of the sieve interval. */
  qsSieveRadius: number;
}

export const DEFAULT_PARAMS: Params = {
  trialBound: 100_000,
  fermatSteps: 200_000,
  rhoSteps: 3_000_000,
  smoothBound: 10_000,
  ecmB1: 20_000,
  ecmB2: 400_000,
  ecmCurves: 60,
  qsFactorBaseBound: 6_000,
  qsSieveRadius: 150_000,
};

/** A step/time cap plus a cancel hook, so a long run stays interruptible. */
export interface Budget {
  maxMs: number;
  /** Called every few thousand steps; returning true aborts as "gave up". */
  cancelled?: () => boolean;
  /** Progress callback for the worker's postMessage stream. */
  onProgress?: (done: number, total: number, note: string) => void;
}

export const NO_BUDGET: Budget = { maxMs: 60_000 };

export type FactorFn = (n: bigint, params: Params, budget: Budget) => FactorOutcome;

export interface AlgorithmMeta {
  id: AlgorithmId;
  /** Display name. */
  name: string;
  /** The structural weakness this method exploits — the whole lesson. */
  exploits: string;
  /** What its cost scales with. */
  driver: CostDriver;
  /** Asymptotic cost, as usually stated. */
  complexity: string;
  citation: string;
}

export const ALGORITHMS: AlgorithmMeta[] = [
  {
    id: 'trial',
    name: 'Trial division',
    exploits: 'a factor small enough to just divide by',
    driver: 'smallest-factor',
    complexity: 'O(p) divisions for the smallest factor p',
    citation: 'Antiquity — the method every other one here is measured against.',
  },
  {
    id: 'fermat',
    name: 'Fermat difference of squares',
    exploits: 'p and q lying close together',
    driver: 'p-q-gap',
    complexity: 'about (p-q)^2 / (8*sqrt(N)) steps',
    citation: 'Fermat, c. 1643 — N = a^2 - b^2 = (a-b)(a+b).',
  },
  {
    id: 'rho',
    name: 'Pollard rho (Brent)',
    exploits: 'a birthday collision modulo the unknown p',
    driver: 'smallest-factor',
    complexity: 'about 1.18 * sqrt(p) iterations',
    citation:
      'Pollard, "A Monte Carlo method for factorization", BIT 15 (1975) 331-334; Brent, "An improved Monte Carlo factorization algorithm", BIT 20 (1980) 176-184.',
  },
  {
    id: 'pminus1',
    name: 'Pollard p-1',
    exploits: 'p - 1 being B-smooth',
    driver: 'p-minus-1-smoothness',
    complexity: 'about B * log B multiplications for bound B',
    citation:
      'Pollard, "Theorems on factorization and primality testing", Proc. Cambridge Philos. Soc. 76 (1974) 521-528.',
  },
  {
    id: 'pplus1',
    name: 'Williams p+1',
    exploits: 'p + 1 being B-smooth',
    driver: 'p-plus-1-smoothness',
    complexity: 'about B * log B Lucas steps for bound B',
    citation: 'Williams, "A p+1 method of factoring", Math. Comp. 39 (1982) 225-234.',
  },
  {
    id: 'ecm',
    name: 'Lenstra ECM',
    exploits: 'SOME elliptic curve over F_p having smooth order',
    driver: 'curve-order-smoothness',
    complexity: 'sub-exponential in p, essentially independent of N',
    citation:
      'H. W. Lenstra Jr., "Factoring integers with elliptic curves", Annals of Mathematics 126 (1987) 649-673.',
  },
  {
    id: 'qs',
    name: 'Quadratic sieve',
    exploits: 'nothing about p or q — only relations x^2 = y^2 (mod N)',
    driver: 'size-of-N',
    complexity: 'L_N[1/2, 1] — sub-exponential in the size of N itself',
    citation:
      'Pomerance, "The quadratic sieve factoring algorithm", EUROCRYPT 84, LNCS 209, 169-182.',
  },
];

export function algorithmMeta(id: AlgorithmId): AlgorithmMeta {
  const m = ALGORITHMS.find((a) => a.id === id);
  if (!m) throw new Error(`unknown algorithm: ${id}`);
  return m;
}

/** Small helper so every module builds outcomes the same way. */
export function gaveUp(
  algorithm: AlgorithmId,
  steps: TraceStep[],
  metrics: { key: string; value: string }[],
  reason: string,
  at: string,
  ms: number
): FactorOutcome {
  return {
    p: null,
    q: null,
    ms,
    trace: { algorithm, steps, metrics, why: null, gaveUp: { reason, at } },
  };
}
