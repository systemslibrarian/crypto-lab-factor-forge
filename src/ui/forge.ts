/**
 * "Weak N Forge" — build an N that falls to exactly one method.
 *
 * The generator does not return a candidate until it has RUN the targeted
 * algorithm against it and RUN the others that must fail (invariant I4). What
 * this panel shows is that proof, as it actually ran: which method won, which
 * ones gave up, and what they gave up on.
 */

import { algorithmMeta } from '../factor/types';
import { WEAKNESSES, type WeaknessTarget } from '../gen/weak';
import { clear, el, groupDigits, kv, table, verdict } from './dom';
import type { Runner } from './runner';
import { emit, setN, state } from './state';

export function mountForgePanel(root: HTMLElement, runner: Runner): () => void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'intro' },
      el('h2', { text: 'Build a weak N on purpose' }),
      el('p', {
        text:
          'Pick the weakness and this builds a modulus that has it — then proves the point by running the method that exploits it and the methods that cannot. Nothing is returned until both halves of that check have actually run.',
      }),
      el('p', {
        class: 'small muted',
        text:
          'Read the rules in the right-hand column as what RSA key generation is FOR. Each one exists because of exactly one method on the race board.',
      })
    )
  );

  const card = el('div', { class: 'card' });
  const field = el('div', { class: 'field' });
  field.append(el('label', { for: 'weak-target', text: 'Target weakness' }));
  const select = el('select', { id: 'weak-target' }) as HTMLSelectElement;
  for (const w of WEAKNESSES) {
    select.append(el('option', { value: w.target, text: w.label }));
  }
  field.append(select);

  const bitsField = el('div', { class: 'field' });
  bitsField.append(el('label', { for: 'weak-bits', text: 'Size of N in bits' }));
  const bits = el('select', { id: 'weak-bits' }) as HTMLSelectElement;
  for (const b of [48, 56, 64, 72]) {
    bits.append(el('option', { value: String(b), text: `${b} bits` }));
  }
  bits.value = '56';
  bitsField.append(bits);

  const blurb = el('p', { class: 'small muted', id: 'weak-blurb' });
  const rule = el('p', { class: 'small', id: 'weak-rule' });

  const controls = el('div', { class: 'row', style: 'margin-top:.6rem' });
  const go = el('button', { class: 'btn btn-primary', id: 'forge-go', type: 'button' }, 'Forge and prove it');
  const use = el('button', { class: 'btn', id: 'forge-use', type: 'button' }, 'Send to the race board');
  use.setAttribute('disabled', 'true');
  controls.append(go, use);

  card.append(el('h2', { text: 'The forge' }), field, bitsField, blurb, rule, controls);
  root.append(card);

  const out = el('div', { id: 'forge-out', role: 'status', 'aria-live': 'polite' });
  root.append(out);

  const describe = (): void => {
    const spec = WEAKNESSES.find((w) => w.target === (select.value as WeaknessTarget))!;
    blurb.textContent = spec.blurb;
    clear(rule);
    rule.append(el('strong', { text: 'RSA key-generation rule: ' }), document.createTextNode(spec.rule));
  };
  describe();
  select.addEventListener('change', describe);

  go.addEventListener('click', () => {
    void forge(runner, select.value as WeaknessTarget, Number(bits.value), out, go, use);
  });
  use.addEventListener('click', () => {
    if (!state.lastGenerated) return;
    setN(BigInt(state.lastGenerated.n));
    const tab = document.querySelector<HTMLButtonElement>('#tab-race');
    tab?.click();
    const input = document.querySelector<HTMLTextAreaElement>('#n-input');
    if (input) {
      input.value = state.lastGenerated.n;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  return () => {
    if (state.lastGenerated) use.removeAttribute('disabled');
    else use.setAttribute('disabled', 'true');
  };
}

async function forge(
  runner: Runner,
  target: WeaknessTarget,
  bits: number,
  out: HTMLElement,
  go: HTMLElement,
  use: HTMLElement
): Promise<void> {
  go.setAttribute('disabled', 'true');
  clear(out);
  out.append(el('p', { class: 'progress', text: 'Generating candidates and running the proof…' }));
  try {
    const g = await runner.generate(target, bits, state.params);
    state.lastGenerated = g;
    clear(out);

    const spec = WEAKNESSES.find((w) => w.target === target)!;
    const card = el('div', { class: 'card' });
    card.append(el('h2', { text: `A ${g.bits}-bit N with: ${spec.label}` }));
    card.append(el('div', { class: 'bignum', id: 'forged-n', text: groupDigits(g.n) }));
    card.append(el('h3', { text: 'The structure, computed' }));
    card.append(kv(g.evidence));

    card.append(el('h3', { text: 'The proof this N is what it claims (invariant I4)' }));
    const rows: (string | Node)[][] = [];
    if (g.proof.targeted) {
      rows.push([
        algorithmMeta(g.proof.targeted).name,
        'must SUCCEED',
        el('span', { class: 'pill pill-ok', text: '✓ factored it' }),
        `${g.proof.targetedMs.toFixed(1)} ms`,
      ]);
    }
    for (const r of g.proof.resisted) {
      rows.push([
        algorithmMeta(r.id).name,
        'must FAIL',
        el('span', { class: r.failed ? 'pill pill-ok' : 'pill pill-bad', text: r.failed ? '✓ gave up' : '✗ succeeded' }),
        `${r.ms.toFixed(1)} ms — ${r.reason}`,
      ]);
    }
    card.append(table(['Method', 'Required', 'Observed', 'Detail'], rows, 'Generation proof'));
    card.append(
      el('p', {
        class: 'small muted',
        text: `Candidate ${g.attempts} of at most 80 — earlier candidates that failed either half of this check were discarded, not shipped with a disclaimer.`,
      })
    );

    out.append(card);

    // ── The negative claim, as a RESULT rather than a disclaimer ──────────
    // Every check in the table above just reported success: all four
    // structure-hunting methods correctly gave up on this N. So run the two
    // that need no structure, on the very same N, and show what that buys.
    if (target === 'none') {
      const neg = el('div', { class: 'card', id: 'negative-claim' });
      neg.append(el('h2', { text: 'What those four green rows do NOT buy' }));
      neg.append(
        el('p', {
          class: 'negative-claim-text',
          id: 'negative-claim-text',
          text:
            'NEGATIVE CLAIM: obeying every key-generation rule on this page does not make N hard to factor — it only removes the methods that need a structure. Pollard rho and Lenstra ECM need none, and neither does Shor, which no rule here touches at all.',
        })
      );
      const evidence = el('div', { id: 'negative-claim-evidence' });
      neg.append(evidence);
      out.append(neg);

      evidence.append(el('p', { class: 'progress', text: 'Running the structure-free methods on the same N…' }));
      const results = await Promise.all([
        runner.factor('rho', BigInt(g.n), state.params, state.capMs),
        runner.factor('ecm', BigInt(g.n), state.params, state.capMs),
      ]);
      clear(evidence);
      for (const outcome of results) {
        const ok = outcome.p !== null && BigInt(outcome.p) * BigInt(outcome.q!) === BigInt(g.n);
        evidence.append(
          verdict(
            ok ? 'alarm' : 'idle',
            ok
              ? `${algorithmMeta(outcome.algorithm).name}: FACTORED IT ANYWAY in ${outcome.ms.toFixed(1)} ms`
              : `${algorithmMeta(outcome.algorithm).name}: gave up at this cap`,
            ok
              ? `p = ${outcome.p}, q = ${outcome.q} — verified by multiplying back to N. Every rule was obeyed and it made no difference to this method.`
              : outcome.trace.gaveUp?.reason
          )
        );
      }
      evidence.append(
        el('p', {
          class: 'small muted',
          text:
            'At a real 2048-bit size these two would fail, because their cost tracks the size of the SMALLEST factor and that would be 1024 bits. The rules are still worth obeying — they are just not what makes RSA hard. Size is.',
        })
      );
    }
    use.removeAttribute('disabled');
    emit();
  } catch (err) {
    clear(out);
    out.append(
      verdict('fail', 'Generation failed.', err instanceof Error ? err.message : String(err))
    );
  } finally {
    go.removeAttribute('disabled');
  }
}
