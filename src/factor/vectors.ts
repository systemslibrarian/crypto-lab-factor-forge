/**
 * Pinned test vectors.
 *
 * Sizes were chosen at build time by measuring this lab in a browser and are
 * FIXED here so the claims suite tests the same numbers every run. Each vector
 * names the structure it carries, and that structure was verified when it was
 * pinned (the largest prime factor of p-1 / p+1 is recorded, not guessed).
 *
 * These are teaching sizes. Nothing here is anywhere near an RSA modulus, and
 * the README says exactly how far it is.
 */

import type { AlgorithmId } from './types';

export interface Vector {
  id: string;
  label: string;
  n: bigint;
  p: bigint;
  q: bigint;
  /** What is structurally true about this N — the thing an algorithm can find. */
  structure: string;
  /** Methods expected to succeed at the default parameters. */
  falls: AlgorithmId[];
  /** Methods expected to fail within their cap at the default parameters. */
  resists: AlgorithmId[];
}

export const VECTORS: Vector[] = [
  {
    id: 'small-factor',
    label: 'A small factor left in',
    p: 99991n,
    q: 1000613679049n,
    n: 100052362381788559n,
    structure:
      'p = 99,991 sits under the trial-division bound, and a 17-bit factor is small enough that every method here reaches it. This is the shape RSA key generation prevents by construction.',
    falls: ['trial', 'rho', 'pminus1', 'pplus1', 'ecm', 'qs'],
    resists: ['fermat'],
  },
  {
    id: 'close-primes',
    label: 'p and q ten apart',
    p: 243698803295737n,
    q: 243698803295747n,
    n: 59389106727776751881115330539n,
    structure: '|p - q| = 10, so ceil(sqrt(N)) is already within a step or two of (p+q)/2.',
    falls: ['fermat', 'ecm'],
    resists: ['trial', 'rho', 'pminus1', 'pplus1', 'qs'],
  },
  {
    id: 'smooth-pminus1',
    label: 'p - 1 is 500-smooth',
    p: 21998936387n,
    q: 16969668467n,
    n: 373314657114012808729n,
    structure: 'p - 1 has largest prime factor 397; q is a safe prime, so q - 1 has a 34-bit prime factor.',
    falls: ['rho', 'pminus1', 'pplus1', 'ecm'],
    resists: ['trial', 'fermat', 'qs'],
  },
  {
    id: 'smooth-pplus1',
    label: 'p + 1 is 500-smooth',
    p: 22820328877n,
    q: 11256989123n,
    n: 256888193951671804871n,
    structure:
      'p + 1 has largest prime factor 499, while p - 1 has one of 82,682,351 — so p+1 catches it and p-1 does not.',
    falls: ['rho', 'pplus1', 'ecm'],
    resists: ['trial', 'fermat', 'pminus1', 'qs'],
  },
  {
    id: 'safe-primes',
    label: 'Two safe primes, nothing smooth',
    p: 604086479n,
    q: 1068059087n,
    n: 645200053229784673n,
    structure:
      'p and q are safe primes and all four of p-1, p+1, q-1, q+1 keep a prime factor far above 10,000. No smoothness to exploit, and the primes are 460 million apart.',
    falls: ['rho', 'ecm', 'qs'],
    resists: ['trial', 'fermat', 'pminus1', 'pplus1'],
  },
  {
    id: 'ecm-only',
    label: 'A 28-bit factor inside a 91-bit N',
    p: 194105641n,
    q: 12051279001098882647n,
    n: 2339221235378138320579711727n,
    structure:
      'p - 1 and p + 1 both keep a prime factor above a million, so neither Pollard nor Williams reaches it; the factor is still only 28 bits, which is all ECM cares about.',
    falls: ['rho', 'ecm'],
    resists: ['trial', 'fermat', 'pminus1', 'pplus1', 'qs'],
  },
  {
    id: 'qs-target',
    label: 'A 52-bit balanced semiprime',
    p: 34206287n,
    q: 47954483n,
    n: 1640344808434621n,
    structure:
      'Balanced 26-bit safe primes, far enough apart that Fermat cannot reach them inside its cap, and nothing smooth. The quadratic sieve has no structure to exploit here — and does not need any.',
    falls: ['rho', 'ecm', 'qs'],
    resists: ['trial', 'fermat', 'pminus1', 'pplus1'],
  },
];

export function vector(id: string): Vector {
  const v = VECTORS.find((x) => x.id === id);
  if (!v) throw new Error(`unknown vector: ${id}`);
  return v;
}

/** Edge-case inputs: not semiprimes, and each teaches its own message. */
export const EDGE_CASES = {
  prime: 32416190071n,
  perfectPower: 1000003n ** 2n, // 1000003^2, where rho stalls unless it is caught first
  threeFactors: 446536200662911111n, // 243527 * 629513 * 2912761
  even: 704245091749937064n,
  one: 1n,
} as const;
