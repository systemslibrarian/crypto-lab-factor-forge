import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  REFLOW,
  reportCollected,
  scan,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where the
 * race board stands idle on the pinned close-primes vector and the other four
 * tabpanels are hidden and UNRENDERED; the shared skip link focused; a winning
 * row and a gave-up row on the board at the same time; each of the three
 * shapes of N that change what the methods can mean (prime, perfect power,
 * even) with the retired-board note beside them; both input failure branches,
 * each behind an `aria-invalid` boundary; the parameters disclosure opened
 * through its summary and driven out of range; the quadratic sieve's win,
 * which paints the longest status text on the page; the recursion tree's pass
 * verdict over a scrollable table; the Weak N Forge before and after
 * generation, including the §4.1d negative-claim fixture where every check
 * reports success and the modulus falls anyway; the trace stepper at step 0,
 * one step in, fully revealed, and on a give-up trace; the ladder's seven
 * per-driver charts with one numbers-disclosure opened; the Shor comparison;
 * three hover states; and three focus rings. Every one of those states is
 * scanned, at desktop and phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (the old gate's
 * `addStyleTag` motion kill bypassed the stylesheet's own reduced-motion
 * block, so the rendering reduced-motion readers get was never the one
 * scanned), why no panel is revealed from script (the old gate stripped every
 * `[hidden]` and opened every `<details>` by JS before its only scan), why the
 * lab's defaults are asserted rather than assumed, and why `violations` is not
 * the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  /**
   * SC 1.4.10 Reflow is specified at 320 CSS px, not at the 380 the drive above
   * uses, and two real overflow defects lived in that 60-pixel gap. The full
   * drive is not repeated here -- it takes minutes and the criteria it covers
   * are width-independent -- but every panel is opened and scanned, which is
   * what reflow needs.
   */
  test(`no WCAG A/AA violations in ${theme} theme at 320px, the width SC 1.4.10 specifies`, async ({
    page,
  }) => {
    test.setTimeout(900_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(REFLOW);
    await boot(page, theme);
    await scan(page, `${theme} @320px / arrival`);
    for (const [name, panel] of [
      ['Weak N Forge', '#panel-forge'],
      ['Trace', '#panel-trace'],
      ['The Ladder', '#panel-ladder'],
      ['Shor', '#panel-shor'],
    ] as const) {
      await page.getByRole('tab', { name: new RegExp(name) }).click();
      await expect(page.locator(panel)).toBeVisible();
      await scan(page, `${theme} @320px / ${name}`);
    }
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });

  /**
   * Forced colours (Windows High Contrast) replaces every author background and
   * border with a system colour, so any state carried by a fill or a border hue
   * disappears. `style.css` has a `@media (forced-colors: active)` block for
   * exactly that; without a pass that emulates it, the block is a claim rather
   * than a measurement.
   */
  test(`state survives forced colours in ${theme} theme`, async ({ page }) => {
    test.setTimeout(600_000);
    const errors = watchPageErrors(page);
    await page.emulateMedia({ forcedColors: 'active' });
    await boot(page, theme);
    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
      'forced-colors emulation must actually be in effect'
    ).toBe(true);
    // The selected tab must still be distinguishable from an unselected one by
    // something forced colours preserves.
    const distinguishable = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('.tab-btn'));
      const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      const other = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
      if (!selected || !other) return 'missing tabs';
      const a = getComputedStyle(selected);
      const b = getComputedStyle(other);
      const differs = [
        a.backgroundColor !== b.backgroundColor,
        a.borderTopStyle !== b.borderTopStyle,
        a.borderTopWidth !== b.borderTopWidth,
        a.outlineStyle !== b.outlineStyle,
        a.textDecorationLine !== b.textDecorationLine,
        a.forcedColorAdjust !== b.forcedColorAdjust,
      ];
      return differs.some(Boolean) ? 'ok' : `identical: bg=${a.backgroundColor} border=${a.borderTopStyle}`;
    });
    expect(distinguishable, 'the selected tab must remain distinguishable in forced colours').toBe('ok');
    await scan(page, `${theme} / forced colours`);
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });
}
