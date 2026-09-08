import './style.css';
import { mountForgePanel } from './ui/forge';
import { mountLadderPanel } from './ui/ladder';
import { mountRacePanel } from './ui/race';
import { Runner } from './ui/runner';
import { mountShorPanel } from './ui/shor';
import { mountTracePanel } from './ui/trace';
import { setN, state, subscribe } from './ui/state';
import { VECTORS } from './factor/vectors';

const runner = new Runner();

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
// the board immediately shows five methods failing where one wins.
setN(VECTORS.find((v) => v.id === 'close-primes')!.n);
state.traceFocus = null;

wireTabs();
activate('race');
