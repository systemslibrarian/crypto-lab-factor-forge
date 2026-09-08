import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
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
}
