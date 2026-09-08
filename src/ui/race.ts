/**
 * "Factor N" — the input, the shape of N, and the race board.
 *
 * The board is where the lesson lands: seven methods against one N, each
 * reporting not just whether it won but WHICH structural property it found or
 * failed to find. Colour on every row is driven by `verifyFactorization`
 * (invariant I1), never by what the algorithm said about itself.
 */

import { algorithmMeta, type AlgorithmId } from '../factor/types';
import { ALGORITHM_ORDER } from '../factor/registry';
import { VECTORS } from '../factor/vectors';
import { describeShape } from '../verify/verify';
import { treeLeaves, type TreeNode } from '../factor/tree';
import { clear, el, groupDigits, table, verdict } from './dom';
import { paramsCard } from './params';
import type { Runner } from './runner';
import { recordRun, setN, state, emit } from './state';
import { whySentence } from './why';

const MAX_DIGITS = 40;

/** Mounts the panel once and returns the function that re-renders the board. */
export function mountRacePanel(root: HTMLElement, runner: Runner): () => void {
  clear(root);

  root.append(
    el(
      'div',
      { class: 'intro' },
      el('h2', { text: 'Factoring is not one problem' }),
      el('p', {
        text:
          'There is no single "factoring algorithm". Every classical method below hunts for one specific weakness in N: a small factor, two primes that sit close together, a smooth p-1 or p+1, an elliptic curve that happens to have smooth order — or, for the quadratic sieve, no weakness at all. Run them side by side and the differences become the whole point.',
      }),
      el('p', {
        class: 'small muted',
        text:
          'Everything here is real BigInt arithmetic running in your browser at teaching sizes. Nothing is simulated, and nothing here threatens a real RSA key — see the honesty note at the bottom of this panel.',
      })
    )
  );

  // ── Input ──────────────────────────────────────────────────────────────
  const card = el('div', { class: 'card' });
  card.append(el('h2', { text: 'The number to factor' }));

  const presetWrap = el('div', { class: 'field' });
  presetWrap.append(el('label', { for: 'preset', text: 'Pinned examples' }));
  const preset = el('select', { id: 'preset' }) as HTMLSelectElement;
  preset.append(el('option', { value: '', text: 'Custom N (type your own below)' }));
  for (const v of VECTORS) {
    preset.append(
      el('option', { value: v.id, text: `${v.label} — ${v.n.toString(2).length}-bit N` })
    );
  }
  const arriving = VECTORS.find((v) => v.n === state.n);
  if (arriving) preset.value = arriving.id;
  presetWrap.append(preset);

  const nWrap = el('div', { class: 'field' });
  nWrap.append(el('label', { for: 'n-input', text: 'N (decimal)' }));
  const nInput = el('textarea', {
    id: 'n-input',
    rows: '2',
    spellcheck: 'false',
    'aria-describedby': 'n-help',
  }) as HTMLTextAreaElement;
  nInput.value = String(state.n);
  nWrap.append(nInput);
  nWrap.append(
    el('p', {
      id: 'n-help',
      class: 'small muted',
      text: `Up to ${MAX_DIGITS} digits. That ceiling is not a property of the maths — it is what this page can finish in a browser while you watch, measured on this machine.`,
    })
  );

  card.append(presetWrap, nWrap, paramsCard());

  const shapeBox = el('div', { id: 'shape-box', role: 'status', 'aria-live': 'polite' });
  card.append(shapeBox);

  const controls = el('div', { class: 'row', style: 'margin-top:.7rem' });
  const runAll = el('button', { class: 'btn btn-primary', id: 'run-all', type: 'button' }, 'Race all seven');
  const cancel = el('button', { class: 'btn', id: 'cancel', type: 'button' }, 'Cancel');
  cancel.setAttribute('disabled', 'true');
  controls.append(runAll, cancel);
  card.append(controls);
  root.append(card);

  // ── Board ──────────────────────────────────────────────────────────────
  const boardCard = el('div', { class: 'card' });
  boardCard.append(el('h2', { text: 'The race board' }));
  boardCard.append(
    el('p', {
      class: 'small muted',
      text:
        'Each row runs until it finds a factor or hits its cap. A row that gives up says what it gave up on — that is a result about N, not a bug.',
    })
  );
  const board = el('div', { class: 'board', id: 'board', role: 'list', 'aria-label': 'Algorithm results' });
  boardCard.append(board);
  root.append(boardCard);

  // ── Recursive factorization, for an N with three or more prime factors ──
  const treeCard = el('div', { class: 'card' });
  treeCard.append(el('h2', { text: 'More than two factors' }));
  treeCard.append(
    el('p', {
      class: 'small muted',
      text:
        'Every method above returns ONE split. When N has three or more prime factors, the split has to be applied again to each composite piece — and the second split is often a different method from the first. This runs that recursion and shows the tree.',
    })
  );
  const treeBtn = el('button', { class: 'btn', id: 'tree-run', type: 'button' }, 'Factor N completely');
  const treeOut = el('div', { id: 'tree-out', role: 'status', 'aria-live': 'polite' });
  treeBtn.addEventListener('click', () => {
    void runTree(runner, treeBtn, treeOut);
  });
  treeCard.append(treeBtn, treeOut);
  root.append(treeCard);

  root.append(
    el(
      'div',
      { class: 'note' },
      el('strong', { text: 'What this does NOT show. ' }),
      document.createTextNode(
        'These are teaching-sized numbers. A real 2048-bit RSA modulus is out of reach of every method on this page and of the number field sieve too, which is why RSA still works. Timings here are real measurements of this browser on this machine and are never extrapolated upward.'
      )
    )
  );

  // ── Wiring ─────────────────────────────────────────────────────────────
  preset.addEventListener('change', () => {
    const v = VECTORS.find((x) => x.id === preset.value);
    if (!v) return;
    nInput.value = String(v.n);
    applyN(nInput, shapeBox);
  });

  nInput.addEventListener('input', () => {
    preset.value = '';
    applyN(nInput, shapeBox);
  });

  runAll.addEventListener('click', () => {
    void raceAll(runner, runAll, cancel);
  });
  cancel.addEventListener('click', () => {
    runner.cancel();
    state.running.clear();
    emit();
  });

  applyN(nInput, shapeBox);
  renderBoard(board, runner);

  // The shell (including the textarea the reader is typing in) is built once;
  // only the board re-renders, so a state change never eats an input's caret.
  return () => {
    renderBoard(board, runner);
    const busy = state.running.size > 0;
    if (busy) cancel.removeAttribute('disabled');
    else cancel.setAttribute('disabled', 'true');
  };
}

function applyN(input: HTMLTextAreaElement, shapeBox: HTMLElement): void {
  const raw = input.value.replace(/[\s,_]/g, '');
  clear(shapeBox);
  if (!/^\d+$/.test(raw)) {
    input.setAttribute('aria-invalid', 'true');
    shapeBox.append(verdict('fail', 'N must be a decimal integer.', 'Digits only — no letters, no hex.'));
    return;
  }
  if (raw.length > MAX_DIGITS) {
    input.setAttribute('aria-invalid', 'true');
    shapeBox.append(
      verdict(
        'fail',
        `That is ${raw.length} digits; this page stops at ${MAX_DIGITS}.`,
        'Beyond that the sieve stops finishing inside a browser tab, and a demo that never finishes teaches nothing.'
      )
    );
    return;
  }
  input.setAttribute('aria-invalid', 'false');
  const n = BigInt(raw);
  setN(n);

  const shape = describeShape(n);
  const bits = shape.bits;
  const notes: HTMLElement[] = [];
  if (shape.degenerate) {
    notes.push(
      verdict(
        'alarm',
        shape.degenerate,
        shape.prime
          ? `Miller-Rabin says prime${shape.primeDeterministic ? ' (proven-deterministic base set at this size)' : ' (probabilistic — random bases at this size)'}. Every method below will simply fail, and that failure is the correct answer.`
          : undefined
      )
    );
  }
  if (shape.perfectPower) {
    notes.push(
      verdict(
        'alarm',
        `N is a perfect power: ${shape.perfectPower.base}^${shape.perfectPower.exponent}.`,
        'Worth knowing before you start — Pollard rho famously stalls on a perfect square, because there is no second prime for the walk to collide against.'
      )
    );
  }
  if (shape.even && !shape.prime) {
    notes.push(verdict('alarm', 'N is even.', 'The factor 2 is peeled off directly by every method here.'));
  }
  if (notes.length === 0) {
    notes.push(
      verdict('idle', `${bits}-bit composite, odd, not a perfect power.`, 'Nothing degenerate — a fair target.')
    );
  }
  for (const nn of notes) shapeBox.append(nn);
  shapeBox.append(el('div', { class: 'bignum', text: groupDigits(raw) }));
}

function renderBoard(board: HTMLElement, runner: Runner): void {
  clear(board);
  if (state.retired) {
    board.append(
      el('div', {
        class: 'retired-note small',
        id: 'retired-note',
        text: `Results retired: N changed, so all ${state.retired.count} verdict(s) for ${state.retired.from} were discarded. A verdict belongs to the N it was computed for.`,
      })
    );
  }
  for (const id of ALGORITHM_ORDER) {
    board.append(raceRow(id, runner));
  }
}

function raceRow(id: AlgorithmId, runner: Runner): HTMLElement {
  const meta = algorithmMeta(id);
  const record = state.runs.get(id);
  const running = state.running.has(id);
  const row = el('div', { class: 'race-row', role: 'listitem', 'data-algorithm': id });

  const name = el('div', { class: 'race-name' });
  name.append(document.createTextNode(meta.name));
  name.append(el('span', { class: 'race-exploits', text: `exploits: ${meta.exploits}` }));
  row.append(name);

  const status = el('div', { class: 'race-status' });
  if (running) {
    row.dataset.state = 'busy';
    status.append(el('span', { class: 'progress', id: `progress-${id}`, text: 'running…' }));
  } else if (!record) {
    row.dataset.state = 'idle';
    status.append(el('span', { class: 'muted', text: 'not run yet' }));
  } else {
    const v = record.verdict;
    if (v.status === 'verified' && v.fullyFactored) {
      row.dataset.state = 'pass';
      status.append(
        el('span', { class: 'pill pill-ok', text: '✓ FACTORED — verified' }),
        el('div', { class: 'small', text: `p = ${record.outcome.p}, q = ${record.outcome.q}` }),
        el('div', { class: 'small muted', text: whySentence(record.outcome.trace) })
      );
    } else if (v.status === 'verified') {
      row.dataset.state = 'alarm';
      status.append(
        el('span', { class: 'pill pill-bad', text: '⚠ PARTIAL SPLIT' }),
        el('div', { class: 'small', text: v.reason })
      );
    } else if (v.status === 'refuted') {
      row.dataset.state = 'fail';
      status.append(
        el('span', { class: 'pill pill-bad', text: '✗ REFUTED by the verifier' }),
        el('div', { class: 'small', text: v.reason })
      );
    } else {
      row.dataset.state = 'fail';
      const g = record.outcome.trace.gaveUp;
      status.append(
        el('span', { class: 'pill', text: '— GAVE UP' }),
        el('div', { class: 'small', text: g ? `${g.reason} (at ${g.at})` : 'no factor found' })
      );
    }
  }
  row.append(status);

  const actions = el('div', { class: 'race-actions' });
  const btn = el('button', { class: 'btn', type: 'button', 'data-run': id }, running ? 'Running…' : 'Run');
  if (running) btn.setAttribute('disabled', 'true');
  btn.addEventListener('click', () => {
    void runOne(runner, id);
  });
  actions.append(btn);
  if (record) {
    actions.append(el('span', { class: 'race-time', text: `${record.outcome.ms.toFixed(1)} ms` }));
  }
  row.append(actions);
  return row;
}

async function runTree(runner: Runner, btn: HTMLElement, out: HTMLElement): Promise<void> {
  btn.setAttribute('disabled', 'true');
  clear(out);
  out.append(el('p', { class: 'progress', text: 'Recursing…' }));
  try {
    const { root: node, ms } = await runner.tree(state.n, state.params, state.capMs);
    const leaves = treeLeaves(node);
    const product = leaves.reduce((acc, v) => acc * BigInt(v), 1n);
    clear(out);
    if (node.stuck || product !== state.n) {
      out.append(
        verdict(
          'fail',
          'Incomplete factorization.',
          node.stuck ?? 'The leaves do not multiply back to N — reported as a failure, not dressed up as a result.'
        )
      );
    } else {
      out.append(
        verdict(
          'pass',
          `N = ${leaves.join(' × ')}`,
          `${leaves.length} prime factors, verified by multiplying back to N. Recursion took ${ms.toFixed(1)} ms in total.`
        )
      );
    }
    out.append(
      table(
        ['Composite', 'Split by', 'Time'],
        splitRows(node),
        'Which method split each composite'
      )
    );
  } catch (err) {
    clear(out);
    out.append(verdict('fail', 'Recursion failed.', err instanceof Error ? err.message : String(err)));
  } finally {
    btn.removeAttribute('disabled');
  }
}

function splitRows(node: TreeNode): string[][] {
  const rows: string[][] = [];
  const walk = (t: TreeNode): void => {
    if (t.via) rows.push([t.value, algorithmMeta(t.via).name, `${t.ms.toFixed(1)} ms`]);
    else if (!t.prime && t.children.length > 0) rows.push([t.value, 'perfect power (peeled directly)', '—']);
    for (const c of t.children) walk(c);
  };
  walk(node);
  return rows;
}

export async function runOne(runner: Runner, id: AlgorithmId): Promise<void> {
  if (state.n < 2n) return;
  state.running.add(id);
  emit();
  try {
    const outcome = await runner.factor(id, state.n, state.params, state.capMs, (done, total, note) => {
      const node = document.getElementById(`progress-${id}`);
      if (node) node.textContent = total > 0 ? `${note} (${Math.round((done / total) * 100)}%)` : note;
    });
    recordRun(outcome);
  } catch {
    state.running.delete(id);
    emit();
  }
}

async function raceAll(runner: Runner, runBtn: HTMLElement, cancelBtn: HTMLElement): Promise<void> {
  runBtn.setAttribute('disabled', 'true');
  cancelBtn.removeAttribute('disabled');
  // Sequential, so the reported milliseconds are a fair comparison rather than
  // seven workers fighting over the same cores.
  for (const id of ALGORITHM_ORDER) {
    await runOne(runner, id);
  }
  runBtn.removeAttribute('disabled');
  cancelBtn.setAttribute('disabled', 'true');
}
