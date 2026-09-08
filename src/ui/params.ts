/**
 * The parameter panel.
 *
 * These are not decoration. The bound B is the entire content of Pollard p-1
 * and Williams p+1 — moving it is how a learner sees which primes a given
 * bound catches and which it does not. The same is true of ECM's curve budget
 * and the sieve's factor base. Every control here changes a real run.
 *
 * Changing any of them retires the board, because a verdict produced under
 * different parameters is not a verdict about these ones.
 */

import { DEFAULT_PARAMS, type Params } from '../factor/types';
import { el } from './dom';
import { emit, state } from './state';

interface Knob {
  key: keyof Params | 'capMs';
  id: string;
  label: string;
  hint: string;
  min: number;
  max: number;
}

const KNOBS: Knob[] = [
  {
    key: 'trialBound',
    id: 'p-trial',
    label: 'Trial division: highest prime tried',
    hint: 'Cost is linear in this. Doubling it doubles the run and buys one bit of reachable factor.',
    min: 100,
    max: 5_000_000,
  },
  {
    key: 'fermatSteps',
    id: 'p-fermat',
    label: 'Fermat: maximum steps above ceil(sqrt(N))',
    hint: 'The search needs about (p-q)^2 / (8*sqrt(N)) steps. This cap is what turns "far apart" into a reported failure.',
    min: 100,
    max: 5_000_000,
  },
  {
    key: 'rhoSteps',
    id: 'p-rho',
    label: 'Pollard rho: maximum iterations',
    hint: 'About 1.18*sqrt(p) iterations are needed, so this cap sets the size of factor rho can reach — independently of N.',
    min: 1000,
    max: 50_000_000,
  },
  {
    key: 'smoothBound',
    id: 'p-b1',
    label: 'p-1 and p+1: smoothness bound B1',
    hint: 'THE knob for both methods. A prime p is caught only if p-1 (or p+1) is built entirely from primes at or below B1, with at most one larger prime picked up in stage 2.',
    min: 10,
    max: 1_000_000,
  },
  {
    key: 'ecmB1',
    id: 'p-ecm-b1',
    label: 'ECM: stage-1 bound B1',
    hint: 'Same role as above, but applied to the order of a curve rather than to p-1 — and the curve can be redrawn.',
    min: 100,
    max: 1_000_000,
  },
  {
    key: 'ecmB2',
    id: 'p-ecm-b2',
    label: 'ECM: stage-2 bound B2',
    hint: 'Allows one prime factor of the curve order between B1 and B2. Set to B1 to switch stage 2 off and watch the success rate drop.',
    min: 100,
    max: 20_000_000,
  },
  {
    key: 'ecmCurves',
    id: 'p-ecm-curves',
    label: 'ECM: how many curves to draw',
    hint: 'Each curve is an independent draw for a smooth group order. More curves is the other way to buy success, and it is why ECM is not defeated by one unlucky curve.',
    min: 1,
    max: 2000,
  },
  {
    key: 'qsFactorBaseBound',
    id: 'p-qs-b',
    label: 'Quadratic sieve: factor-base bound',
    hint: 'Bigger base means more values count as smooth, but also more relations needed before a dependency exists. That trade-off is the sieve.',
    min: 100,
    max: 100_000,
  },
  {
    key: 'qsSieveRadius',
    id: 'p-qs-m',
    label: 'Quadratic sieve: sieve half-width M',
    hint: 'x runs over [-M, M]. Widen it when the sieve reports too few relations for the number of columns.',
    min: 1000,
    max: 3_000_000,
  },
  {
    key: 'capMs',
    id: 'p-cap',
    label: 'Wall-clock cap per method (ms)',
    hint: 'A real timeout, applied to every method. A run that hits it reports where it stopped rather than pretending to have finished.',
    min: 100,
    max: 120_000,
  },
];

export function paramsCard(): HTMLElement {
  const details = el('details', { class: 'params' });
  details.append(el('summary', { text: 'Parameters — the bounds each method depends on' }));
  details.append(
    el('p', {
      class: 'small muted',
      text:
        'Changing any of these clears the board: a verdict earned under a different bound is not a verdict about this one.',
    })
  );

  const grid = el('div', { class: 'grid-2' });
  for (const knob of KNOBS) {
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { for: knob.id, text: knob.label }));
    const input = el('input', {
      type: 'number',
      id: knob.id,
      min: String(knob.min),
      max: String(knob.max),
      step: '1',
      'aria-describedby': `${knob.id}-hint`,
    }) as HTMLInputElement;
    input.value = String(currentValue(knob.key));
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < knob.min || v > knob.max) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.setAttribute('aria-invalid', 'false');
      setValue(knob.key, Math.round(v));
      state.runs.clear();
      state.traceFocus = null;
      state.traceStep = 0;
      emit();
    });
    wrap.append(input);
    wrap.append(el('p', { id: `${knob.id}-hint`, class: 'small muted', text: knob.hint }));
    grid.append(wrap);
  }
  details.append(grid);

  const reset = el('button', { class: 'btn', type: 'button', id: 'params-reset' }, 'Reset to defaults');
  reset.addEventListener('click', () => {
    state.params = { ...DEFAULT_PARAMS };
    state.capMs = 8000;
    state.runs.clear();
    state.traceFocus = null;
    for (const knob of KNOBS) {
      const input = document.getElementById(knob.id) as HTMLInputElement | null;
      if (input) input.value = String(currentValue(knob.key));
    }
    emit();
  });
  details.append(reset);
  return details;
}

function currentValue(key: Knob['key']): number {
  return key === 'capMs' ? state.capMs : state.params[key];
}

function setValue(key: Knob['key'], value: number): void {
  if (key === 'capMs') state.capMs = value;
  else state.params[key] = value;
}
