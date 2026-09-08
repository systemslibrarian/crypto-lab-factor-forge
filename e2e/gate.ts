import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this replaces did:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the one rendering a reduced-motion reader actually gets — `.panel` and
 *     `.reveal` with their animations cancelled by the stylesheet's own rule —
 *     was never once the rendering that got scanned. This gate sets the
 *     preference through `emulateMedia`, asserts from inside the page that it
 *     took effect (`test.use({ reducedMotion })` silently does nothing on
 *     Playwright 1.61.1), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Stripping `hidden` puts all five tabpanels on screen AT ONCE — a
 *     rendering no reader can reach and axe then scans instead of the real one
 *     — and script-opening the disclosures means the SHUT state, which is what
 *     every reader arrives at, was never scanned at all. This gate switches
 *     tabs by clicking them and opens each disclosure through its `<summary>`,
 *     which is the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked
 *     every button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms per tab, and scanned ONCE at the
 *     end — so the non-numeric-N rendering, the over-long-N branch, the
 *     out-of-range parameter and the stepper's intermediate reveals were all
 *     overwritten before anything measured them, and a click that silently did
 *     nothing looked identical to one that worked. This drive names every
 *     control it touches, asserts a real completion signal after each, and
 *     scans after every step, at 1280px and 380px.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning — every `.verdict-*` tone, both `.pill` states, the
 *     `.intro` and `.cl-hero-why` accent washes and the shared top bar's ink
 *     — are `color-mix()` fills axe files under `incomplete` rather than
 *     judging. So is an `aria-label` on a role-less element.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. The old
 *     spec hand-rolled one luminance check over two input selectors, reading
 *     the DECLARED `border-top-color` and `background-color` — blind to
 *     `color-mix()`, to composited backdrops, to every `.btn`, `.tab-btn`,
 *     `.pill` and number input, and to all states past first paint.
 *     `nontext.ts` replaces it with a measured oracle over every control at
 *     every driven state, and `expectNoHorizontalOverflow` adds the 1.4.10
 *     check axe has no rule for.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels `.panel` / `.reveal` animations and every transition, so
 * `getAnimations()` is normally empty and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE the lab's `@media` block — `* { transition: none !important }` wins
 * today, but that is a property of the current stylesheet, not of the page.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab
 * has EXACTLY that shape in miniature: `@keyframes fade` and `@keyframes
 * reveal` both start `from { opacity: 0 }`, and every tab panel and every
 * stepper line rides one of them. The reduced-motion block cancels both with
 * `animation: none`, which restores the static `opacity: 1` — correct today,
 * and this assertion is what makes that a measurement rather than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is decorative
 * verdict/pill glyphs beside their own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies
 * a second banner today — but the shared bar's `dedupeBanner()` exists because
 * other labs in this fleet DID ship one, and the hero markup is the part of
 * this page most likely to be re-templated from a lab that uses `<header>`.
 * Asserting the OUTCOME rather than the markup is what catches that edit.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab's race board is a `<div role="list">` holding seven
 * `role="listitem"` rows — a list built from divs, which is the shape that
 * needs the explicit roles to have any semantics at all. What is asserted is
 * the SHAPE of that: any explicit role on a `ul`/`ol` must be `list` (any
 * other value orphans every `<li>` under it), and a `role="list"` must never
 * sit on an empty element, because axe applies `aria-required-children` to the
 * explicit role and fails it the day the board renders with no rows. Roles are
 * assigned through `dom.ts`'s element helper rather than written in markup, so
 * ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including
 * the lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia`, but the CSS reduced-motion block is the only thing standing
 * between a scan and the mid-flight `fade`/`reveal` opacities, so the
 * assertion is still the difference between scanning the reduced-motion
 * rendering and merely believing we did.
 *
 * The theme is seeded through `localStorage` rather than by clicking the
 * toggle, which pins down a real coupling as a side effect: `index.html`'s
 * anti-flash script reads `localStorage.getItem('theme')` and the shared bar's
 * toggle writes `localStorage.setItem('theme', …)`. Both agree on `'theme'`;
 * if either drifted, this boot fails on `data-theme` rather than quietly
 * scanning dark twice.
 *
 * The defaults are asserted at length because `main.ts` renders each tabpanel
 * lazily on first activation, and the Factor N panel builds seven board rows
 * and a shape readout at mount. A navigation that resolves proves nothing: a
 * renderer that threw would leave `#panel-race` empty, and an empty region is
 * exactly what a scan reports as perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('.tab-btn')).toHaveCount(5);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it — a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all —
  // not the shared bar's, which was removed, and not a lab-local one. The
  // shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── The arrival state: Factor N active, board built, nothing run yet ────
  // `mountRacePanel` builds seven idle rows and the shape readout for the
  // pinned close-primes vector. The other four panels are lazily rendered:
  // hidden AND EMPTY until their tab is first activated — asserted, because
  // "empty" is this lab's tell that a renderer threw (see `watchPageErrors`).
  await expect(page.locator('#panel-race .race-row')).toHaveCount(7);
  await expect(page.locator('#panel-race .race-row[data-state="idle"]')).toHaveCount(7);
  for (const id of ['forge', 'trace', 'ladder', 'shor']) {
    await expect(page.locator(`#panel-${id}`)).toBeHidden();
    await expect(page.locator(`#panel-${id}`)).toBeEmpty();
  }

  // ── Every shipped control default ───────────────────────────────────────
  // The arrival N is the pinned "p and q ten apart" vector, and the preset
  // select must agree with the textarea rather than reading "Custom" beside a
  // value it recognises.
  await expect(page.locator('#n-input')).toHaveValue('59389106727776751881115330539');
  await expect(page.locator('#preset')).toHaveValue('close-primes');
  await expect(page.locator('#shape-box')).toContainText('96-bit composite');
  await expect(page.locator('#p-b1')).toHaveValue('10000');
  await expect(page.locator('#p-cap')).toHaveValue('8000');

  // ── Disclosures ship shut ───────────────────────────────────────────────
  // The parameters block arrives closed; the gate this replaces opened every
  // one from script before its only scan.
  await expect(page.locator('#panel-race details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all. This lab's long
 * values are 40-digit moduli and 90-digit trace intermediates — `.bignum` and
 * every `.kv dd` rely on `overflow-wrap: anywhere` instead of a scroll region,
 * the `.race-row` grid collapses to one column at 640px, and the four tables
 * live inside `.table-scroll` — so the shapes at risk are a new unwrapped
 * `<code>` run, a grid item whose automatic minimum size is the min-content of
 * an unbroken digit run, or an SVG chart that does not shrink. At 380px that
 * is precisely what this check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab has four real scrollers: every table is wrapped in
 * `.table-scroll { overflow-x: auto }` by `dom.ts`'s `table()` helper, which
 * is also where the `tabindex="0"` + `role="region"` + `aria-label` triple is
 * applied. So this assertion is load-bearing rather than vacuous — it is what
 * catches a table built by hand instead of through that helper, and a scroller
 * born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: every
 *    verdict tone, both pill states, the danger/caveat callouts, the
 *    `.intro` panels, the hero aside and the shared bar's ink. Everything
 *    else in that bucket is a real result axe simply could not finish —
 *    including `aria-prohibited-attr`, which is where an `aria-label` on a
 *    role-less element hides. This page leans on getting that right: every
 *    `.table-scroll` carries `role="region"` with its `aria-label`, and the
 *    race board carries `role="list"` with one. Drop either role and the label
 *    is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Switch to a tab by clicking it, and prove the switch happened. */
async function openTab(page: Page, name: RegExp, panelId: string): Promise<void> {
  await page.getByRole('tab', { name }).click();
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(panelId)).toBeVisible();
  await expect(page.locator(panelId)).not.toBeEmpty();
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: Factor
 *    N active with seven idle rows on the pinned close-primes vector, four
 *    panels hidden and unrendered, the parameters disclosure shut. The gate
 *    this replaces force-revealed all of it before its only scan.
 *
 *  - EVERY PANEL IS RENDERED LAZILY, so a tab that is never clicked is a
 *    panel that is never even IN the DOM. Each of the five is activated
 *    through its real tab button and scanned in its own driven states.
 *
 *  - EVERY ERROR AND REJECTION STATE. A malformed private key paints
 *    `aria-invalid` and replaces the signed output with a failure verdict; a
 *    over-long N does the same through the digit ceiling; a parameter typed
 *    outside its range flips `aria-invalid` on a number input; and half the
 *    board is give-up rows, which is the state this lab is most about.
 *    None of these is reachable without driving the page on purpose, and
 *    none had ever been scanned.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the
 *    state a reader occupies the instant after pressing Run — and
 *    `.tab-btn:hover`, `.btn:hover` and `.cl-btn:hover` all repaint their fill
 *    or border. Each is scanned explicitly.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM completion signal: a
 *    verdict appearing, a pill's wording, a step counter, `aria-selected`.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const row = (algo: string) => page.locator(`.race-row[data-algorithm="${algo}"]`);
  const runRow = async (algo: string): Promise<void> => {
    await row(algo).getByRole('button', { name: 'Run' }).click();
    await expect(row(algo).locator('.race-time')).toBeVisible({ timeout: 120_000 });
  };

  await scanAt('arrival: the board idle on the close-primes vector, four panels unrendered, parameters shut');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── A winning row and a losing row, side by side ────────────────────────
  await runRow('fermat');
  await expect(row('fermat')).toHaveAttribute('data-state', 'pass');
  await expect(row('fermat').locator('.pill-ok')).toContainText('FACTORED — verified');
  await scanAt('Factor N: Fermat wins on close primes — the verified pass row');

  await runRow('trial');
  await expect(row('trial')).toHaveAttribute('data-state', 'fail');
  await expect(row('trial').locator('.race-status')).toContainText('GAVE UP');
  await scanAt('Factor N: trial division gives up — a pass row and a give-up row together');

  // ── The three shapes of N that change what the methods can mean ─────────
  // Each renders its own alarm verdict, and none of them was reachable in the
  // arrival state.
  await page.locator('#n-input').fill('32416190071');
  await expect(page.locator('#shape-box')).toContainText('nothing to factor');
  await expect(page.locator('#retired-note')).toContainText('Results retired');
  await scanAt('Factor N: a prime N — the alarm verdict plus the retired-board note');

  await page.locator('#n-input').fill('1000006000009');
  await expect(page.locator('#shape-box')).toContainText('perfect power');
  await scanAt('Factor N: a perfect power — the second alarm shape');

  await page.locator('#n-input').fill('704245091749937064');
  await expect(page.locator('#shape-box')).toContainText('N is even');
  await scanAt('Factor N: an even N');

  // ── Both input failure branches ─────────────────────────────────────────
  await page.locator('#n-input').fill('not-a-number');
  await expect(page.locator('#n-input')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#shape-box .verdict-fail')).toContainText('decimal integer');
  await scanAt('Factor N: a non-numeric N — aria-invalid boundary and a failure verdict');

  await page.locator('#n-input').fill('1'.repeat(45));
  await expect(page.locator('#shape-box .verdict-fail')).toContainText('digits');
  await scanAt('Factor N: an over-long N — the digit-ceiling failure verdict');

  // ── The parameters disclosure, opened the way a reader opens it ─────────
  await page.locator('#n-input').fill('1640344808434621');
  await expect(page.locator('#shape-box')).toContainText('51-bit composite');
  await page.locator('#panel-race details.params > summary').click();
  await expect(page.locator('#panel-race details.params[open]')).toHaveCount(1);
  await scanAt('Factor N: the parameters disclosure open');

  await page.locator('#p-b1').fill('999999999');
  await page.locator('#p-b1').blur();
  await expect(page.locator('#p-b1')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('Factor N: a parameter out of range — aria-invalid on a number input');
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.locator('#p-b1')).toHaveValue('10000');

  // ── The quadratic sieve, which renders the widest content on the page ───
  await runRow('qs');
  await expect(row('qs')).toHaveAttribute('data-state', 'pass');
  await scanAt('Factor N: the sieve wins — the longest status text on the board');

  // ── Recursive factorization, and its table ──────────────────────────────
  await page.locator('#n-input').fill('446536200662911111');
  await page.getByRole('button', { name: 'Factor N completely' }).click();
  await expect(page.locator('#tree-out .verdict-pass')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#tree-out table')).toBeVisible();
  await scanAt('Factor N: the recursion tree — a pass verdict over a scrollable table');

  // ── Weak N Forge ────────────────────────────────────────────────────────
  await openTab(page, /Weak N Forge/, '#panel-forge');
  await scanAt('Forge: arrival — the target selector and its rule, nothing generated');

  await page.locator('#weak-target').selectOption('smooth-pplus1');
  await page.locator('#weak-bits').selectOption('56');
  await page.getByRole('button', { name: 'Forge and prove it' }).click();
  await expect(page.locator('#forged-n')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#forge-out .pill-ok').first()).toBeVisible();
  await scanAt('Forge: a smooth-p+1 modulus with its generation proof table');

  // The negative-claim fixture: every check green, and the modulus falls
  // anyway. This is the state §4.1d exists for, so it is scanned in full.
  await page.locator('#weak-target').selectOption('none');
  await page.getByRole('button', { name: 'Forge and prove it' }).click();
  await expect(page.locator('#negative-claim-text')).toBeVisible({ timeout: 180_000 });
  await expect(page.locator('#negative-claim-evidence .verdict-alarm').first()).toBeVisible({
    timeout: 180_000,
  });
  await scanAt('Forge: the negative-claim fixture — four green rows and an alarm verdict');

  // ── Trace ───────────────────────────────────────────────────────────────
  // Reached FIRST in its empty state. Every run so far belonged to an N that
  // has since been replaced, so the board was retired and this panel has
  // nothing to show — which is a real arrival state for it, and one the drive
  // would never see if it ran a method immediately beforehand.
  await openTab(page, /Trace/, '#panel-trace');
  await expect(page.locator('#panel-trace .verdict-idle')).toContainText('Nothing to trace yet');
  await scanAt('Trace: the empty state, after the board was retired');

  // Now give it something to trace: one win and one give-up on the same N.
  await openTab(page, /Factor N/, '#panel-race');
  await page.locator('#n-input').fill('373314657114012808729');
  await expect(page.locator('#shape-box')).toContainText('69-bit composite');
  await runRow('pminus1');
  await expect(row('pminus1')).toHaveAttribute('data-state', 'pass');
  await runRow('trial');
  await expect(row('trial')).toHaveAttribute('data-state', 'fail');

  await openTab(page, /Trace/, '#panel-trace');
  await expect(page.locator('#trace-progress')).toHaveText(/Step 0 \/ \d+/);
  await expect(page.getByRole('button', { name: '‹ Back' })).toBeDisabled();
  await scanAt('Trace: step 0 — Back disabled, no steps revealed yet');

  await page.getByRole('button', { name: 'Next ›' }).click();
  await expect(page.locator('.trace-step')).toHaveCount(1);
  await scanAt('Trace: one step revealed');

  await page.getByRole('button', { name: 'Show all steps' }).click();
  await expect(page.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  await expect(page.locator('.trace-step[data-pivotal="true"]').first()).toBeVisible();
  await scanAt('Trace: every step revealed, including the pivotal one, and a pass verdict');

  await page.locator('#trace-pick').selectOption('trial');
  await page.getByRole('button', { name: 'Show all steps' }).click();
  await expect(page.locator('#panel-trace .verdict-fail')).toContainText('GAVE UP');
  await scanAt('Trace: a give-up trace — the failure verdict and its stated cause');

  // ── The Ladder ──────────────────────────────────────────────────────────
  await openTab(page, /The Ladder/, '#panel-ladder');
  await expect(page.locator('.ladder-card')).toHaveCount(7);
  await expect(page.locator('#panel-ladder svg[role="img"]')).toHaveCount(8);
  await scanAt('Ladder: seven per-driver charts plus the against-N chart, all disclosures shut');

  await page.locator('#panel-ladder details').first().locator('summary').click();
  await expect(page.locator('#panel-ladder details[open]')).toHaveCount(1);
  await scanAt('Ladder: a chart\u2019s numbers disclosure open');

  // ── Shor & the RSA Rules ────────────────────────────────────────────────
  await openTab(page, /Shor/, '#panel-shor');
  await expect(page.locator('#panel-shor .pill-bad')).toHaveCount(6);
  await expect(page.locator('#panel-shor .verdict-alarm')).toBeVisible();
  await scanAt('Shor: the rules table, the comparison table and the alarm verdict');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.getByRole('tab', { name: 'Factor N' }).hover();
  await scanAt('an inactive tab hovered — its surface-2 fill repainted');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  await openTab(page, /Factor N/, '#panel-race');
  await page.getByRole('button', { name: 'Race all seven' }).hover();
  await scanAt('a primary button hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.locator('#n-input').focus();
  await expect(page.locator('#n-input')).toBeFocused();
  await scanAt('a textarea focused, showing its focus-visible outline');

  await page.locator('#preset').focus();
  await scanAt('a styled select focused — appearance:none plus a custom chevron');

  await page.getByRole('tab', { name: 'Factor N' }).focus();
  await scanAt('the active tab focused');
}
