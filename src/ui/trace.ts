/**
 * "Trace" — step through what a run actually did.
 *
 * The stepper reveals one step at a time so the mechanism is watched rather
 * than read: the sequence of x_i and the gcd that pops for rho; the a-walk for
 * Fermat; the curve counter and the non-invertible denominator for ECM; the
 * relation matrix and the GF(2) dependency for the sieve.
 */

import { algorithmMeta, type AlgorithmId } from '../factor/types';
import { ALGORITHM_ORDER } from '../factor/registry';
import { clear, el, kv, verdict } from './dom';
import { completedRuns, emit, state } from './state';
import { whyDetail } from './why';

export function mountTracePanel(root: HTMLElement): () => void {
  const render = (): void => {
    clear(root);
    root.append(
      el(
        'div',
        { class: 'intro' },
        el('h2', { text: 'Watch one method work' }),
        el('p', {
          text:
            'Every run above keeps its trace. Step through it and the mechanism shows itself: which quantity the method was really hunting, and the exact moment the factor fell out.',
        })
      )
    );

    const runs = completedRuns();
    const done = ALGORITHM_ORDER.filter((id) => runs.has(id));
    if (done.length === 0) {
      root.append(
        verdict('idle', 'Nothing to trace yet.', 'Run a method on the "Factor N" tab and its trace appears here.')
      );
      return;
    }
    if (!state.traceFocus || !runs.has(state.traceFocus)) {
      state.traceFocus = done[0];
      state.traceStep = 0;
    }

    const card = el('div', { class: 'card' });
    const field = el('div', { class: 'field' });
    field.append(el('label', { for: 'trace-pick', text: 'Trace which run' }));
    const pick = el('select', { id: 'trace-pick' }) as HTMLSelectElement;
    for (const id of done) {
      const rec = runs.get(id)!;
      const won = rec.verdict.status === 'verified';
      pick.append(
        el('option', {
          value: id,
          text: `${algorithmMeta(id).name} — ${won ? 'factored' : 'gave up'} in ${rec.outcome.ms.toFixed(1)} ms`,
        })
      );
    }
    pick.value = state.traceFocus;
    pick.addEventListener('change', () => {
      state.traceFocus = pick.value as AlgorithmId;
      state.traceStep = 0;
      emit();
    });
    field.append(pick);
    card.append(field);

    const record = runs.get(state.traceFocus)!;
    const meta = algorithmMeta(state.traceFocus);
    const steps = record.outcome.trace.steps;
    const shown = Math.min(state.traceStep, steps.length);

    card.append(
      el('p', { class: 'small muted', text: `${meta.name} exploits ${meta.exploits}. Cost: ${meta.complexity}.` })
    );

    const nav = el('div', { class: 'row' });
    const back = el('button', { class: 'btn', id: 'trace-back', type: 'button' }, '‹ Back');
    const next = el('button', { class: 'btn btn-primary', id: 'trace-next', type: 'button' }, 'Next ›');
    const all = el('button', { class: 'btn', id: 'trace-all', type: 'button' }, 'Show all steps');
    const progress = el('span', { class: 'step-progress', id: 'trace-progress', text: `Step ${shown} / ${steps.length}` });
    if (shown === 0) back.setAttribute('disabled', 'true');
    if (shown >= steps.length) next.setAttribute('disabled', 'true');
    back.addEventListener('click', () => {
      state.traceStep = Math.max(0, shown - 1);
      emit();
    });
    next.addEventListener('click', () => {
      state.traceStep = Math.min(steps.length, shown + 1);
      emit();
    });
    all.addEventListener('click', () => {
      state.traceStep = steps.length;
      emit();
    });
    nav.append(back, next, all, progress);
    card.append(nav);

    const list = el('div', { id: 'trace-steps' });
    for (const s of steps.slice(0, shown)) {
      const box = el('div', { class: 'trace-step', 'data-pivotal': s.pivotal ? 'true' : 'false' });
      if (s.pivotal) {
        // A REAL element, not only the CSS ::before that also marks it. The
        // pivotal step is the moment the factor falls out -- the single most
        // important line in the trace -- and it used to be distinguished by
        // border colour alone (SC 1.4.1). Generated content fixes the visual
        // half, but whether a screen reader announces it is engine-dependent,
        // so the word is in the markup too.
        box.append(el('span', { class: 'trace-pivot', text: 'Pivotal step' }));
      }
      box.append(el('div', { class: 'trace-label', text: s.label }));
      box.append(el('p', { class: 'trace-detail', text: s.detail }));
      if (s.values && s.values.length > 0) box.append(kv(s.values));
      list.append(box);
    }
    card.append(list);
    root.append(card);

    const summary = el('div', { class: 'card' });
    summary.append(el('h2', { text: 'The verdict, and why' }));
    const v = record.verdict;
    if (v.status === 'verified' && v.fullyFactored) {
      summary.append(
        verdict(
          'pass',
          'FACTORED — verified',
          `${v.product} = ${record.outcome.p} × ${record.outcome.q}; Miller-Rabin calls both prime${v.factors.every((f) => f.deterministic) ? ' with the proven-deterministic base set at this size' : ' using random bases at this size, so the primality is probabilistic'}.`
        )
      );
      if (record.outcome.trace.why) summary.append(whyDetail(record.outcome.trace.why));
    } else if (v.status === 'no-claim') {
      const g = record.outcome.trace.gaveUp;
      summary.append(
        verdict('fail', 'GAVE UP — no factor', g ? `${g.reason}, at ${g.at}.` : 'no detail recorded')
      );
      summary.append(
        el('p', {
          class: 'small muted',
          text:
            'Nothing here is faked into a success. A method that runs out of budget reports where it stopped, and that is often the more interesting result: it is a statement about the shape of N.',
        })
      );
    } else {
      summary.append(verdict('fail', 'REFUTED by the verifier', v.reason));
    }
    summary.append(el('p', { class: 'small muted', text: meta.citation }));
    root.append(summary);
  };

  render();
  return render;
}
