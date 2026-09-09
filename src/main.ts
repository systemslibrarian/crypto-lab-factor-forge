import './style.css';
import { mountForgePanel } from './ui/forge';
import { mountLadderPanel } from './ui/ladder';
import { mountRacePanel } from './ui/race';
import { Runner } from './ui/runner';
import { mountShorPanel } from './ui/shor';
import { mountTracePanel } from './ui/trace';
import { PARAM_LIMITS } from './ui/params';
import { restoreFromUrl } from './ui/provenance';
import { setCanceller, setN, state, subscribe } from './ui/state';
import { buildLabel } from './ui/build';
import { VECTORS } from './factor/vectors';

const runner = new Runner();

// Changing the experiment stops the work that belonged to the old one, rather
// than letting it run to completion so its result can be thrown away.
setCanceller(() => runner.cancel());

/**
 * Panels mount lazily on first activation, and each returns its own update
 * function. Nothing re-mounts on a state change, so an input the reader is
 * typing in is never rebuilt underneath them.
 */
type Mounted = { update: () => void };
const mounted = new Map<string, Mounted>();

const MOUNTERS: Record<string, (root: HTMLElement) => () => void> = {
  race: (root) => mountRacePanel(root, runner),
  forge: (root) => mountForgePanel(root, runner),
  trace: (root) => mountTracePanel(root),
  ladder: (root) => mountLadderPanel(root),
  shor: (root) => mountShorPanel(root),
};

function activate(panel: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab-btn')) {
    const selected = tab.dataset.panel === panel;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const section of document.querySelectorAll<HTMLElement>('.panel')) {
    const selected = section.id === `panel-${panel}`;
    section.hidden = !selected;
  }
  const root = document.getElementById(`panel-${panel}`);
  if (!root) return;
  if (!mounted.has(panel)) {
    mounted.set(panel, { update: MOUNTERS[panel](root) });
  } else {
    mounted.get(panel)!.update();
  }
}

function wireTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab-btn')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab.dataset.panel!));
    tab.addEventListener('keydown', (e) => {
      const key = e.key;
      if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
      e.preventDefault();
      const next =
        key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (i + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      activate(tabs[next].dataset.panel!);
    });
  });
}

subscribe(() => {
  for (const [panel, m] of mounted) {
    const root = document.getElementById(`panel-${panel}`);
    if (root && !root.hidden) m.update();
  }
});

// The arrival state is the pinned "p and q ten apart" vector: small enough that
// the whole board finishes in well under a second, and structured enough that
// the board immediately shows most methods failing where two win.
//
// A permalink overrides it. Everything from the URL is validated against the
// same ranges the controls enforce -- a shared link is untrusted input, and an
// rhoSteps of 1e12 arriving that way would hang the tab exactly as surely as
// one typed by hand.
const restored = restoreFromUrl(PARAM_LIMITS);
Object.assign(state.params, restored.params);
if (restored.capMs !== null) state.capMs = restored.capMs;
setN(restored.n ?? VECTORS.find((v) => v.id === 'close-primes')!.n);
state.traceFocus = null;
state.retired = null;

wireTabs();
activate(restored.tab ?? 'race');

if (restored.rejected.length > 0) {
  // Say it rather than silently clamping: a link that means something different
  // from what it says is worse than a link that refuses.
  const note = document.getElementById('url-note');
  if (note) {
    note.textContent = `Ignored ${restored.rejected.length} value(s) from the link that fall outside the accepted ranges: ${restored.rejected.join(', ')}. The defaults are in use for those.`;
    note.hidden = false;
  }
}

// Stamp the build into the footer so an exported run can be tied to the code
// that produced it.
const stamp = document.getElementById('build-stamp');
if (stamp) stamp.textContent = buildLabel();
