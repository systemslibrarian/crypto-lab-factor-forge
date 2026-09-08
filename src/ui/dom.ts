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
