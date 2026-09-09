/** Tiny DOM helpers. Everything the page shows is built through these. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function kv(pairs: { key: string; value: string }[]): HTMLElement {
  const dl = el('dl', { class: 'kv' });
  for (const p of pairs) {
    dl.append(el('dt', { text: p.key }), el('dd', { text: p.value }));
  }
  return dl;
}

/**
 * A verdict line. Colour is only ever one of three carriers — the glyph and
 * the words say the same thing, so the state survives greyscale and
 * deuteranopia (WCAG 1.4.1).
 */
export function verdict(
  tone: 'pass' | 'fail' | 'alarm' | 'idle',
  headline: string,
  detail?: string
): HTMLElement {
  const glyph = { pass: '✓', fail: '✗', alarm: '⚠', idle: '—' }[tone];
  const box = el('div', { class: `verdict verdict-${tone}` });
  box.append(el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: glyph }));
  const body = el('div');
  body.append(el('span', { text: headline }));
  if (detail) body.append(el('div', { class: 'small', style: 'font-weight:400', text: detail }));
  box.append(body);
  return box;
}

export function table(headers: string[], rows: (string | Node)[][], label: string): HTMLElement {
  const wrap = el('div', { class: 'table-scroll', role: 'region', tabindex: '0', 'aria-label': label });
  const t = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const h of headers) hr.append(el('th', { scope: 'col', text: h }));
  thead.append(hr);
  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    for (const cell of row) {
      const td = el('td');
      td.append(typeof cell === 'string' ? document.createTextNode(cell) : cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}

/** Group a digit run so a 90-bit N stays readable. */
export function groupDigits(v: string): string {
  return v.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Keep keyboard focus alive across a re-render (WCAG 2.4.3 Focus Order, Level A).
 *
 * Every panel here rebuilds its DOM from the store on each state change, which
 * is what keeps the rendering and the state impossible to disagree. The cost was
 * a real and serious keyboard barrier: pressing Enter on a board Run button
 * destroyed that button, and `document.activeElement` fell back to `<body>` --
 * measured, not theorised. A keyboard user was thrown to the top of the document
 * every time they ran anything, and had to Tab all the way back to run the next
 * one. Nothing in the axe gate can see this; it is a property of what happens
 * BETWEEN two renders, and axe only ever sees one.
 *
 * So: note which control had focus, by a key that survives the rebuild, and give
 * focus back to its replacement. `preventScroll` because the element is already
 * where the reader left it and yanking the viewport would be its own defect.
 *
 * Focus is restored only when it was genuinely LOST (activeElement is body or
 * null). If the render moved focus deliberately, or the reader moved it
 * themselves mid-render, that decision stands -- stealing focus back would be
 * the same defect pointing the other way.
 */
export function focusKeyOf(el: Element | null): string | null {
  if (!el || el === document.body) return null;
  const key = el.getAttribute('data-focus-key');
  if (key) return `[data-focus-key="${CSS.escape(key)}"]`;
  if (el.id) return `#${CSS.escape(el.id)}`;
  return null;
}

export function preserveFocus(render: () => void): void {
  const key = focusKeyOf(document.activeElement);
  render();
  if (!key) return;
  const active = document.activeElement;
  if (active && active !== document.body) return; // focus survived, or moved on purpose
  const replacement = document.querySelector<HTMLElement>(key);
  if (replacement) replacement.focus({ preventScroll: true });
}

/**
 * Mark a control unavailable WITHOUT removing it from the keyboard.
 *
 * The `disabled` attribute takes an element out of the tab order entirely, and
 * that has two costs this page was paying. A keyboard reader who presses Enter
 * on Run is standing on a control that becomes `disabled` in the same tick:
 * focus has nowhere to go and falls to `<body>` (SC 2.4.3). And a screen-reader
 * user tabbing through never encounters the control at all, so the fact that a
 * run is in progress is simply absent from their experience.
 *
 * `aria-disabled` says the same thing to assistive technology while leaving the
 * control focusable, which is why it is the recommended pattern for exactly this
 * case. The trade is that the browser no longer blocks activation for us, so
 * every handler has to check -- `isDisabled` below, called at the top of each.
 */
export function setDisabled(el: HTMLElement, disabled: boolean): void {
  el.setAttribute('aria-disabled', String(disabled));
  if (disabled) el.setAttribute('data-disabled', 'true');
  else el.removeAttribute('data-disabled');
}

export function isDisabled(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true';
}

/**
 * The page's announcer (WCAG 2.1 SC 4.1.3 Status Messages, Level AA).
 *
 * A run's verdict is the entire product of this page, and it was delivered
 * silently: measured, a seven-run batch produced 8,508 DOM mutations inside
 * `#board` and ZERO inside any live region. `#board` carries `role="list"`, not
 * `role="status"`, so a screen-reader user pressing Run heard nothing at all --
 * not when it started, not when it finished, not what it found. Sighted readers
 * got the whole lesson; everyone else got silence.
 *
 * Deliberately NOT wired to progress. A long rho run emits thousands of progress
 * updates, and piping those into a live region would replace silence with a
 * flood, which is its own defect -- the criterion asks for status messages, not
 * for narration. Only terminal states are announced, plus one summary when a
 * batch finishes.
 *
 * `aria-atomic` so the whole sentence is read rather than the diff, and the text
 * is cleared first: two identical consecutive messages are otherwise dropped as
 * "no change", which is exactly what happens when the same method is run twice.
 */
let announcer: HTMLElement | null = null;

function announcerEl(): HTMLElement {
  if (announcer) return announcer;
  const found = document.getElementById('announcer');
  if (found) {
    announcer = found;
    return found;
  }
  // index.html ships the region so it is in the accessibility tree from first
  // paint. This fallback exists for the unit tests, which have no document of
  // their own, and is deliberately not the normal path -- a live region created
  // at the same moment as its first message is a region whose first message is
  // missed.
  const node = el('div', {
    id: 'announcer',
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  document.body.append(node);
  announcer = node;
  return node;
}

export function announce(message: string): void {
  const node = announcerEl();
  node.textContent = '';
  // A frame apart, so a repeat of the same sentence is seen as a change.
  requestAnimationFrame(() => {
    node.textContent = message;
  });
}
