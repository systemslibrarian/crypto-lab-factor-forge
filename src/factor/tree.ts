/**
 * Recursive factorization, for the "N has three or more factors" edge case.
 *
 * A single split is all any of the methods here returns. To get the whole
 * factorization the split has to be applied again to each composite piece,
 * which is what this does — and the tree it builds is worth showing, because
 * the second split is often a completely different method from the first.
 */

import { perfectPower } from './bigint';
import { isProbablePrime } from './primality';
import { REGISTRY } from './registry';
import type { AlgorithmId, Budget, Params } from './types';

export interface TreeNode {
  value: string;
  prime: boolean;
  /** Which method split this node, if it was split. */
  via: AlgorithmId | null;
  ms: number;
  children: TreeNode[];
  /** Set when the node is composite but nothing here could split it. */
  stuck: string | null;
}

const CHAIN: AlgorithmId[] = ['trial', 'rho', 'pminus1', 'ecm'];

export function factorTree(
  n: bigint,
  params: Params,
  budget: Budget,
  depth = 0
): TreeNode {
  if (isProbablePrime(n)) {
    return { value: String(n), prime: true, via: null, ms: 0, children: [], stuck: null };
  }
  if (depth > 12) {
    return { value: String(n), prime: false, via: null, ms: 0, children: [], stuck: 'recursion depth cap' };
  }

  // A perfect power is peeled first because integer root extraction is the
  // cheap exact answer, not because anything downstream stalls on it. The old
  // comment here said rho "famously stalls on a perfect square"; it does not.
  // Modulo p the walk on N = p^2 is the same recurrence on the same state
  // space, so it collides on the usual sqrt(p) schedule and the gcd hands back
  // p (see the header of rho.ts for the measurement). What is true is the cost:
  // rho would pay about sqrt(p) iterations per split -- N^(1/(2k)) for N = p^k,
  // so N^(1/4) in the square case -- and pay it again for every one of the k - 1
  // splits, while a handful of integer root extractions settle the whole power
  // exactly and return all k copies at once.
  const pp = perfectPower(n);
  if (pp) {
    const kids: TreeNode[] = [];
    for (let i = 0; i < pp.exponent; i++) kids.push(factorTree(pp.base, params, budget, depth + 1));
    return { value: String(n), prime: false, via: null, ms: 0, children: kids, stuck: null };
  }

  for (const id of CHAIN) {
    const out = REGISTRY[id](n, params, budget);
    if (out.p !== null && out.q !== null && out.p * out.q === n && out.p > 1n && out.q > 1n) {
      return {
        value: String(n),
        prime: false,
        via: id,
        ms: out.ms,
        children: [
          factorTree(out.p, params, budget, depth + 1),
          factorTree(out.q, params, budget, depth + 1),
        ],
        stuck: null,
      };
    }
  }
  return {
    value: String(n),
    prime: false,
    via: null,
    ms: 0,
    children: [],
    stuck: 'composite, but no method in the chain split it inside its cap',
  };
}

/** Flatten the leaves into the multiset of prime factors. */
export function treeLeaves(node: TreeNode): string[] {
  if (node.children.length === 0) return [node.value];
  return node.children.flatMap(treeLeaves);
}
