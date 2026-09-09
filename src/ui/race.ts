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
import { isProbablePrime } from '../factor/primality';
import { clear, el, groupDigits, isDisabled, setDisabled, table, verdict } from './dom';
import { exportRun, permalinkFor } from './provenance';
import { paramsCard } from './params';
import type { Runner } from './runner';
import {
  anyRunning,
  batchIsCurrent,
  cancelAll,
  makeContext,
  markBusy,
  markCancelled,
  markError,
  markProgress,
  recordRun,
  rowOf,
  setN,
  startBatch,
  state,
  emit,
  type RunContext,
} from './state';
import { whySentence } from './why';

const MAX_DIGITS = 40;

/** Mounts the panel once and returns the function that re-renders the board. */
export function mountRacePanel(root: HTMLElement, runner: Runner): () => void {
  clear(root);

  // One sentence of setup, then the controls. The full framing is a disclosure
  // directly beneath: at 380px the old two-paragraph intro plus the input card
  // put the primary action 1,658px down the page, which is two screens of
  // reading before a learner can do anything.
  const intro = el('div', { class: 'intro' });
  intro.append(
    el('h2', { text: 'Factoring is not one problem' }),
    el('p', {
      text:
        'Seven methods, one N. Each hunts a different weakness — and which one wins tells you what is wrong with N.',
    })
  );
  const introMore = el('details', { class: 'intro-more' });
  introMore.append(el('summary', { text: 'Why that matters' }));
  introMore.append(
    el('p', {
      class: 'small',
      text:
        'There is no single "factoring algorithm". Every classical method below hunts for one specific weakness in N: a small factor, two primes that sit close together, a smooth p-1 or p+1, an elliptic curve that happens to have smooth order — or, for the quadratic sieve, no weakness at all. Run them side by side and the differences become the whole point.',
    }),
    el('p', {
      class: 'small muted',
      text:
        'Everything here is real BigInt arithmetic running in your browser at teaching sizes. Nothing is simulated, and nothing here threatens a real RSA key — see the honesty note at the bottom of this panel.',
    })
  );
  intro.append(introMore);
  root.append(intro);

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

  card.append(presetWrap, nWrap);

  const shapeBox = el('div', { id: 'shape-box', role: 'status', 'aria-live': 'polite' });
  card.append(shapeBox);

  const controls = el('div', { class: 'row', style: 'margin-top:.7rem' });
  // NOT "Race": the methods run one at a time, deliberately, so the wall-clock
  // numbers on the board are comparable rather than seven jobs fighting over
  // the same cores. Calling it a race implied a concurrency this does not have.
  const runAll = el(
    'button',
    { class: 'btn btn-primary', id: 'run-all', type: 'button' },
    'Run all seven, one at a time'
  );
  const cancel = el('button', { class: 'btn', id: 'cancel', type: 'button' }, 'Cancel');
  setDisabled(cancel, true);
  const permalink = el('button', { class: 'btn', id: 'permalink', type: 'button' }, 'Copy permalink');
  controls.append(runAll, cancel, permalink);
  card.append(controls);
  card.append(
    el('p', {
      class: 'small muted',
      id: 'sequential-note',
      text:
        'They run sequentially, never in parallel: a shared core would make the milliseconds meaningless. Cancel stops the one that is running and everything still queued behind it.',
    })
  );
  const workerNote = el('div', { id: 'worker-note' });
  card.append(workerNote);
  card.append(paramsCard());
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
    if (isDisabled(treeBtn)) return;
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
    if (isDisabled(runAll)) return;
    void runAllSequentially(runner);
  });
  cancel.addEventListener('click', () => {
    if (isDisabled(cancel)) return;
    // Order matters. Invalidate the batch FIRST so nothing queued can start,
    // then terminate the worker. Reversed, the loop's next iteration can slip
    // in between and dispatch a fresh job onto a rebuilt worker.
    cancelAll();
    runner.cancel();
    emit();
  });
  permalink.addEventListener('click', () => {
    void copyPermalink(permalink);
  });

  applyN(nInput, shapeBox);
  renderBoard(board, runner);

  // The shell (including the textarea the reader is typing in) is built once;
  // only the board re-renders, so a state change never eats an input's caret.
  return () => {
    renderBoard(board, runner);
    const busy = anyRunning();
    setDisabled(cancel, !busy);
    setDisabled(runAll, busy);
    renderWorkerNote(workerNote, runner);
  };
}

/**
 * If module workers are unavailable the maths still runs, on the main thread —
 * but that is a different product and the page says so: a long run freezes the
 * tab, and Cancel cannot stop a BigInt loop that has already entered.
 */
function renderWorkerNote(host: HTMLElement, runner: Runner): void {
  const wanted = runner.inlineOnly ? runner.fallbackReason : null;
  if (state.workerNotice === wanted) return;
  state.workerNotice = wanted;
  clear(host);
  if (!wanted) return;
  host.append(
    verdict(
      'alarm',
      'Running on the main thread — Cancel cannot stop a run here.',
      `${wanted}. The arithmetic is unchanged and the results are still real, but a long run will freeze this tab until it finishes or hits its wall-clock cap.`
    )
  );
}

async function copyPermalink(btn: HTMLElement): Promise<void> {
  const url = permalinkFor();
  history.replaceState(null, '', url);
  const label = btn.textContent ?? 'Copy permalink';
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Copy failed — the URL bar now holds it';
  }
  setTimeout(() => {
    btn.textContent = label;
  }, 1600);
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
        'Worth knowing before you start — for N = p^2 the walk still collides modulo p on the usual sqrt(p) schedule, but the split it returns is p x p rather than two distinct primes. The recursion below peels a perfect power directly instead, because knowing the shape is cheaper than searching for it.'
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
    const r = state.retired;
    const parts: string[] = [];
    if (r.completed) parts.push(`${r.completed} completed verdict(s)`);
    if (r.cancelled) parts.push(`${r.cancelled} run(s) still in flight`);
    board.append(
      el('div', {
        class: 'retired-note small',
        id: 'retired-note',
        text: `Results retired: the experiment changed, so ${parts.join(' and ')} for ${r.from} were discarded. A verdict belongs to the N and the bounds it was computed under.`,
      })
    );
  }
  if (state.discarded > 0) {
    board.append(
      el('div', {
        class: 'retired-note small',
        id: 'discarded-note',
        text: `${state.discarded} completion(s) arrived after their experiment had already changed and were discarded rather than attributed to the current one.`,
      })
    );
  }
  for (const id of ALGORITHM_ORDER) {
    board.append(raceRow(id, runner));
  }
}

function raceRow(id: AlgorithmId, runner: Runner): HTMLElement {
  const meta = algorithmMeta(id);
  const row = el('div', { class: 'race-row', role: 'listitem', 'data-algorithm': id });
  const state_ = rowOf(id);

  const name = el('div', { class: 'race-name' });
  name.append(document.createTextNode(meta.name));
  name.append(el('span', { class: 'race-exploits', text: `exploits: ${meta.exploits}` }));
  row.append(name);

  const status = el('div', { class: 'race-status' });
  const actions = el('div', { class: 'race-actions' });

  switch (state_.kind) {
    case 'busy': {
      row.dataset.state = 'busy';
      status.append(el('span', { class: 'progress', id: `progress-${id}`, text: state_.note }));
      break;
    }
    case 'idle': {
      row.dataset.state = 'idle';
      status.append(el('span', { class: 'muted', text: 'not run yet' }));
      break;
    }
    case 'cancelled': {
      // A cancelled run does NOT revert to "not run yet". It happened, it was
      // stopped, and the page says where it had got to.
      row.dataset.state = 'cancelled';
      status.append(
        el('span', { class: 'pill', text: '⊘ CANCELLED' }),
        el('div', { class: 'small', text: `${state_.reason}. No partial result is reported: the worker was terminated, so there is nothing to verify.` }),
        el('div', { class: 'small muted', text: state_.note ? `Last progress seen: ${state_.note}` : 'Stopped before it reported any progress.' })
      );
      break;
    }
    case 'error': {
      row.dataset.state = 'error';
      status.append(
        el('span', { class: 'pill pill-bad', text: '! EXECUTION ERROR' }),
        el('div', { class: 'small', text: state_.message }),
        el('div', { class: 'small muted', text: 'This is a failure of the page, not a result about N. Nothing is claimed.' })
      );
      break;
    }
    case 'done': {
      const record = state_.record;
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
      break;
    }
  }
  row.append(status);

  const busy = state_.kind === 'busy';
  const btn = el(
    'button',
    { class: 'btn', type: 'button', 'data-run': id, 'data-focus-key': `run-${id}` },
    busy ? 'Running…' : state_.kind === 'idle' ? 'Run' : 'Run again'
  );
  setDisabled(btn, busy);
  btn.addEventListener('click', () => {
    if (isDisabled(btn)) return;
    void runOne(runner, id);
  });
  actions.append(btn);

  if (state_.kind === 'done') {
    const rec = state_.record;
    // A capped run's milliseconds are the CAP, not a measurement of the work.
    // Rendering both in the same column, same units, same style made a timeout
    // read as a timing. It is labelled instead.
    const capped = rec.outcome.trace.gaveUp?.reason.includes('time cap') ?? false;
    actions.append(
      el('span', {
        class: `race-time${capped ? ' race-time-capped' : ''}`,
        title: capped
          ? 'This run hit its wall-clock cap; the number is the cap, not how long the work takes.'
          : 'Measured with performance.now() in this browser.',
        text: capped ? `cap ${rec.outcome.ms.toFixed(0)} ms` : `${rec.outcome.ms.toFixed(1)} ms`,
      })
    );
    const exportBtn = el(
      'button',
      { class: 'btn btn-tiny', type: 'button', 'data-focus-key': `export-${id}` },
      'Export run'
    );
    exportBtn.addEventListener('click', () => exportRun(rec));
    actions.append(exportBtn);
  }
  row.append(actions);
  return row;
}

/**
 * Recursive factorization.
 *
 * Three things here were wrong and all three were the same mistake — judging a
 * result against the LIVE store instead of against the experiment that produced
 * it, and judging only the root of a tree instead of the whole tree:
 *
 *  - the product was compared against `state.n`, which the user may have changed
 *    while the recursion ran;
 *  - `node.stuck` is only the ROOT's stuck flag, so a tree with an unsplit
 *    composite two levels down rendered a green "N = a x b x c" verdict;
 *  - nothing checked that the leaves were prime, so a partial factorization
 *    could be presented as a complete one.
 */
async function runTree(runner: Runner, btn: HTMLElement, out: HTMLElement): Promise<void> {
  setDisabled(btn, true);
  clear(out);
  out.append(el('p', { class: 'progress', text: 'Recursing…' }));
  // Snapshot the experiment. Everything below judges against THESE values.
  const ctx = makeContext('trial');
  const res = await runner.tree(ctx.n, ctx.params, ctx.capMs);
  clear(out);

  if (!res.ok) {
    out.append(
      res.kind === 'cancelled'
        ? verdict('idle', 'Cancelled.', 'The recursion was stopped; nothing is claimed.')
        : verdict('fail', 'The recursion could not run.', `${res.message}. This is a failure of the page, not a result about N.`)
    );
    setDisabled(btn, false);
    return;
  }
  if (!contextStillCurrent(ctx)) {
    out.append(
      verdict(
        'idle',
        'Discarded: N changed while this was running.',
        `That tree was computed for ${ctx.n}, which is no longer the number on screen. Attributing it to the current N would be a false statement, so it is thrown away.`
      )
    );
    setDisabled(btn, false);
    return;
  }

  const node = res.root;
  const leaves = treeLeaves(node);
  const product = leaves.reduce((acc, v) => acc * BigInt(v), 1n);
  // The WHOLE tree, not just the root: a stuck composite at any depth means the
  // factorization is incomplete however green the top looks.
  const stuck = firstStuck(node);
  const composite = leaves.find((v) => !isProbablePrime(BigInt(v)));

  if (stuck || product !== ctx.n || composite) {
    out.append(
      verdict(
        'fail',
        'Incomplete factorization.',
        stuck ??
          (composite
            ? `The leaf ${composite} is composite, so this is a partial split and not a factorization into primes.`
            : 'The leaves do not multiply back to N — reported as a failure, not dressed up as a result.')
      )
    );
  } else {
    out.append(
      verdict(
        'pass',
        `N = ${leaves.join(' × ')}`,
        `${leaves.length} factors, each confirmed prime by Miller-Rabin, and their product recomputed back to N. Recursion took ${res.ms.toFixed(1)} ms in total.`
      )
    );
  }
  out.append(
    table(['Composite', 'Split by', 'Time'], splitRows(node), 'Which method split each composite')
  );
  setDisabled(btn, false);
}

/** The first `stuck` reason anywhere in the tree, not just at the root. */
function firstStuck(node: TreeNode): string | null {
  if (node.stuck) return node.stuck;
  for (const c of node.children) {
    const s = firstStuck(c);
    if (s) return s;
  }
  return null;
}

function contextStillCurrent(ctx: RunContext): boolean {
  return ctx.epoch === state.epoch;
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

/**
 * Run one method against a SNAPSHOT of the current experiment.
 *
 * The context is taken before dispatch and travels with the result, so
 * `recordRun` can verify against the N the run was actually given and refuse a
 * completion whose experiment has moved on.
 */
export async function runOne(runner: Runner, id: AlgorithmId): Promise<void> {
  if (state.n < 2n) return;
  const ctx = makeContext(id);
  markBusy(ctx);
  const res = await runner.factor(id, ctx.n, ctx.params, ctx.capMs, ctx.seed, (done, total, note) => {
    const text = total > 0 ? `${note} (${Math.round((done / total) * 100)}%)` : note;
    markProgress(ctx, text);
    // Repaint just this row's progress line rather than the whole board, and
    // only if the row still belongs to this run.
    const row = rowOf(id);
    if (row.kind !== 'busy' || row.ctx.runId !== ctx.runId) return;
    const node = document.getElementById(`progress-${id}`);
    if (node) node.textContent = text;
  });

  if (res.ok) {
    recordRun(res.outcome, ctx);
    return;
  }
  if (res.kind === 'cancelled') markCancelled(ctx, 'cancelled by you');
  else markError(ctx, res.message);
}

/**
 * Run every method in turn, and STOP when cancelled.
 *
 * The loop used to press on after `Cancel`: terminating the worker rejected the
 * job that was running, the empty catch swallowed it, and the next iteration
 * dispatched onto a freshly-built worker. Measured, four rows published results
 * after cancellation — including a PASS verdict twenty seconds later. The batch
 * token is checked before AND after every await, because the user can cancel
 * during either window.
 */
async function runAllSequentially(runner: Runner): Promise<void> {
  const batch = startBatch();
  emit();
  for (const id of ALGORITHM_ORDER) {
    if (!batchIsCurrent(batch)) break;
    await runOne(runner, id);
    if (!batchIsCurrent(batch)) break;
  }
  emit();
}
