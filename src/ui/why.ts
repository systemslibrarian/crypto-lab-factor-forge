/**
 * Rendering for the COMPUTED explanation (invariant I2).
 *
 * Every sentence here is built from numbers the algorithm derived from the
 * recovered factor — the factorization of p-1, the measured |p-q|, the curve
 * order counted over F_p. Nothing asserts a property it did not compute; where
 * a cofactor was too large to factor, it says so instead.
 */

import type { FactorTrace, WhyEvidence } from '../factor/types';
import { el } from './dom';

export function whySentence(trace: FactorTrace): string {
  const why = trace.why;
  if (!why) return trace.gaveUp ? trace.gaveUp.reason : '';
  switch (why.kind) {
    case 'small-factor':
      return `Found by division: the factor ${why.factor} turned up after ${why.divisions.toLocaleString()} trials.`;
    case 'p-q-gap':
      return `|p - q| = ${why.gap} (${why.gapBits} bits), so the search from ceil(sqrt(N)) took ${why.steps.toLocaleString()} steps.`;
    case 'smallest-factor':
      return `The factor is ${why.factorBits} bits; sqrt(p) is about ${why.sqrtFactor} and the walk took ${why.steps.toLocaleString()} steps.`;
    case 'smoothness':
      if (!why.complete) {
        return `${why.group} could not be factored here, so no smoothness claim is made.`;
      }
      // The relation is READ from the evidence, never asserted. This sentence
      // once ended "— under the bound 10,000" beside a largest prime of 55,021.
      return why.withinBound
        ? `${why.group} = ${why.value}, whose largest prime factor is ${why.largestPrime} — at or below the bound ${why.bound.toLocaleString()}.`
        : `${why.group} = ${why.value}, whose largest prime factor is ${why.largestPrime} — ABOVE the bound ${why.bound.toLocaleString()}, so the bound alone does not explain this run.`;
    case 'relations':
      return `${why.relations} smooth relations over a ${why.factorBaseSize}-prime factor base gave ${why.dependencies} dependencies; ${why.trivialAttempts} produced a trivial gcd before one split N.`;
  }
}

export function whyDetail(why: WhyEvidence): HTMLElement {
  const box = el('div');
  switch (why.kind) {
    case 'smoothness': {
      box.append(el('p', { class: 'small', text: whySentence({ why } as FactorTrace) }));
      if (why.complete) {
        const line = why.factorization
          .map((f) => (f.exponent > 1 ? `${f.prime}^${f.exponent}` : f.prime))
          .join(' × ');
        box.append(el('div', { class: 'bignum', text: `${why.value} = ${line}` }));
        box.append(
          el('p', {
            class: 'small muted',
            text: why.withinBound
              ? 'That factorization was computed here from the recovered factor — it is evidence, not a claim.'
              : 'That factorization was computed here from the recovered factor, and it does NOT clear the bound — which is itself the result: something other than the stage-1 bound is what let this run through.',
          })
        );
      }
      return box;
    }
    case 'relations':
      box.append(
        el('p', { class: 'small', text: `x = ${why.x}` }),
        el('p', { class: 'small', text: `y = ${why.y}` }),
        el('p', {
          class: 'small muted',
          text: 'x and y satisfy x² ≡ y² (mod N) with x ≢ ±y, which is the entire content of the method.',
        })
      );
      return box;
    default:
      box.append(el('p', { class: 'small', text: whySentence({ why } as FactorTrace) }));
      return box;
  }
}
