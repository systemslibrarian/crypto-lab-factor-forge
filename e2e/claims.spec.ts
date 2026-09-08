import { expect, test, type Page } from '@playwright/test';
import { isqrtCeil } from '../src/factor/bigint';
import { largestPrimeFactor } from '../src/factor/primality';
import { VECTORS } from '../src/factor/vectors';

/**
 * The claims suite: does the page tell the truth?
 *
 * Two kinds of check, per the standard. CROSS-CHECKS compare two surfaces the
 * page itself printed (the verdict's p and q against the modulus it shows).
 * INDEPENDENT RE-DERIVATIONS recompute a claim from the raw input by a
 * different route than the source takes — the Fermat step count from
 * (p+q)/2 - ceil(sqrt(N)), the smoothness of p-1 by factoring it here — so a
 * page that is consistently wrong still fails.
 */

const V = (id: string) => VECTORS.find((v) => v.id === id)!;

async function setN(page: Page, n: bigint): Promise<void> {
  await page.locator('#n-input').fill(String(n));
}

async function run(page: Page, algo: string): Promise<void> {
  const row = page.locator(`.race-row[data-algorithm="${algo}"]`);
  await row.getByRole('button', { name: 'Run' }).click();
  await expect(row.locator('.race-time')).toBeVisible({ timeout: 120_000 });
}

function rowFor(page: Page, algo: string) {
  return page.locator(`.race-row[data-algorithm="${algo}"]`);
}

/**
 * The deployment check. Every asset on this page — including the module worker
 * the long runs live in — must resolve under the GitHub Pages PROJECT SUBPATH,
 * not the domain root. A root-absolute path 404s there and nowhere else, so it
 * is invisible in `npm run dev` and fatal in production. This runs against
 * `vite preview` serving the real build at the real subpath.
 */
test('every asset resolves under the Pages project subpath, worker included', async ({ page }) => {
  const failed: string[] = [];
  const notFound: string[] = [];
  page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => {
    if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('.');
  await expect(page.locator('.race-row')).toHaveCount(7);
  // Force the worker to be constructed and to answer.
  await run(page, 'fermat');
  await expect(rowFor(page, 'fermat')).toHaveAttribute('data-state', 'pass');

  const workerRequests = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('worker'))
  );
  expect(workerRequests.length, 'the module worker must actually have been fetched').toBeGreaterThan(0);
  for (const url of workerRequests) {
    expect(url, 'the worker must be fetched from the project subpath').toContain(
      '/crypto-lab-factor-forge/'
    );
  }
  expect(failed, failed.join('\n')).toEqual([]);
  expect(notFound, notFound.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('.race-row')).toHaveCount(7);
});

test('C1: the headline claim recomputes from the values on screen', async ({ page }) => {
  const v = V('qs-target');
  await setN(page, v.n);
  await run(page, 'qs');
  const row = rowFor(page, 'qs');
  await expect(row).toHaveAttribute('data-state', 'pass');

  // Read p and q out of the rendered verdict, and multiply them here.
  const text = await row.locator('.race-status').innerText();
  const m = text.match(/p = (\d+), q = (\d+)/);
  expect(m, `no p/q in: ${text}`).not.toBeNull();
  const p = BigInt(m![1]);
  const q = BigInt(m![2]);
  expect(p * q).toBe(v.n);

  // And against the modulus the page itself printed in the shape box.
  const shown = (await page.locator('#shape-box .bignum').innerText()).replace(/\s/g, '');
  expect(BigInt(shown)).toBe(p * q);
});

test('C1: a verified factorization is announced as verified, in words and in an icon', async ({ page }) => {
  await setN(page, V('smooth-pminus1').n);
  await run(page, 'pminus1');
  const row = rowFor(page, 'pminus1');
  await expect(row).toHaveAttribute('data-state', 'pass');
  // Colour is never the only carrier: the pill says it and shows a glyph.
  await expect(row.locator('.pill-ok')).toContainText('FACTORED — verified');
  await expect(row.locator('.pill-ok')).toContainText('✓');
});

test('C2: rho reports a step count consistent with sqrt(p), not with N', async ({ page }) => {
  // Two vectors: the SMALLER factor lives in the LARGER N. If rho tracked N,
  // the bigger N would cost more. It does not.
  const small = V('small-factor'); // 17-bit factor, 57-bit N
  const bigger = V('safe-primes'); // 30-bit factor, 60-bit N

  const stepsOf = async (n: bigint): Promise<number> => {
    await setN(page, n);
    await run(page, 'rho');
    const row = rowFor(page, 'rho');
    await expect(row).toHaveAttribute('data-state', 'pass');
    const text = await row.locator('.race-status').innerText();
    const m = text.match(/walk took ([\d,]+) steps/);
    expect(m, `no step count in: ${text}`).not.toBeNull();
    return Number(m![1].replace(/,/g, ''));
  };

  const a = await stepsOf(small.n);
  const b = await stepsOf(bigger.n);
  const sqrtRatio = Math.sqrt(Number(bigger.p) / Number(small.p));
  expect(b / a).toBeGreaterThan(sqrtRatio / 25);
  expect(b / a).toBeLessThan(sqrtRatio * 25);
});

test('C3: p-1 wins on a smooth p-1 and the smoothness re-derives here', async ({ page }) => {
  const v = V('smooth-pminus1');
  await setN(page, v.n);
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');

  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.locator('#trace-pick').selectOption('pminus1');
  await page.getByRole('button', { name: 'Show all steps' }).click();

  const body = await page.locator('#panel-trace').innerText();
  const m = body.match(/p - 1 = ([\d\s×^*]+)/);
  expect(m, `no factorization of p-1 shown in the trace`).not.toBeNull();

  // Independent re-derivation: factor p-1 here and compare the largest prime.
  const largest = largestPrimeFactor(v.p - 1n) ?? largestPrimeFactor(v.q - 1n)!;
  expect(body).toContain(String(largest));
});

test('C3 (negative): p-1 FAILS on the safe-prime vector and names the cause', async ({ page }) => {
  const v = V('safe-primes');
  await setN(page, v.n);
  await run(page, 'pminus1');
  const row = rowFor(page, 'pminus1');
  await expect(row).toHaveAttribute('data-state', 'fail');
  await expect(row.locator('.race-status')).toContainText('GAVE UP');
  await expect(row.locator('.race-status')).toContainText('smooth');

  // Independently: both p-1 and q-1 really do keep a large prime factor.
  expect(largestPrimeFactor(v.p - 1n)!).toBeGreaterThan(10_000n);
  expect(largestPrimeFactor(v.q - 1n)!).toBeGreaterThan(10_000n);
});

test('C4: Fermat wins on close primes with the step count re-derived here', async ({ page }) => {
  const v = V('close-primes');
  await setN(page, v.n);
  await run(page, 'fermat');
  const row = rowFor(page, 'fermat');
  await expect(row).toHaveAttribute('data-state', 'pass');

  const text = await row.locator('.race-status').innerText();
  const m = text.match(/\|p - q\| = (\d+) \((\d+) bits\), so the search from ceil\(sqrt\(N\)\) took ([\d,]+) steps/);
  expect(m, `no gap/steps sentence in: ${text}`).not.toBeNull();
  expect(BigInt(m![1])).toBe(v.q - v.p);
  // Independent re-derivation: a = (p+q)/2, so the walk length is fixed.
  expect(BigInt(m![3].replace(/,/g, ''))).toBe((v.p + v.q) / 2n - isqrtCeil(v.n));
});

test('C4 (negative): Fermat fails inside its cap on balanced primes', async ({ page }) => {
  const v = V('safe-primes');
  await setN(page, v.n);
  await run(page, 'fermat');
  const row = rowFor(page, 'fermat');
  await expect(row).toHaveAttribute('data-state', 'fail');
  await expect(row.locator('.race-status')).toContainText('no square within');
  // The distance it would have needed, computed here.
  expect((v.p + v.q) / 2n - isqrtCeil(v.n)).toBeGreaterThan(200_000n);
});

test('C5: ECM reports a curve order that satisfies Hasse and factors as shown', async ({ page }) => {
  const v = V('ecm-only');
  await setN(page, v.n);
  await run(page, 'ecm');
  await expect(rowFor(page, 'ecm')).toHaveAttribute('data-state', 'pass');

  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.locator('#trace-pick').selectOption('ecm');
  await page.getByRole('button', { name: 'Show all steps' }).click();
  const body = await page.locator('#panel-trace').innerText();

  const orderLine = body.match(/(#E\(F_p\)|order of P)\s*\n?\s*(\d+)/);
  expect(orderLine, `no curve order in the trace:\n${body.slice(0, 1200)}`).not.toBeNull();
  const order = BigInt(orderLine![2]);

  // Independent check: Hasse's bound on the recovered factor.
  const p = v.p;
  const root = BigInt(Math.floor(Math.sqrt(Number(p))));
  expect(order).toBeGreaterThan(p + 1n - 3n * root);
  expect(order).toBeLessThan(p + 1n + 3n * root);

  // And the factorization the page printed really multiplies back to it.
  const fac = body.match(new RegExp(`${order} = ([\\d\\s×^]+)`));
  expect(fac, 'the curve order was shown but not factored').not.toBeNull();
  const product = fac![1]
    .trim()
    .split('×')
    .map((t) => t.trim())
    .filter(Boolean)
    .reduce((acc, term) => {
      const [b, e] = term.split('^');
      return acc * BigInt(b.trim()) ** BigInt(e ? e.trim() : '1');
    }, 1n);
  expect(product).toBe(order);
});

test('C6: the sieve prints an x and y with x^2 = y^2 (mod N) and x != +/- y', async ({ page }) => {
  const v = V('qs-target');
  await setN(page, v.n);
  await run(page, 'qs');
  await expect(rowFor(page, 'qs')).toHaveAttribute('data-state', 'pass');

  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.locator('#trace-pick').selectOption('qs');
  await page.getByRole('button', { name: 'Show all steps' }).click();
  const body = await page.locator('#panel-trace').innerText();

  const xm = body.match(/x = (\d+)/);
  const ym = body.match(/y = (\d+)/);
  expect(xm, 'no x printed').not.toBeNull();
  expect(ym, 'no y printed').not.toBeNull();
  const x = BigInt(xm![1]) % v.n;
  const y = BigInt(ym![1]) % v.n;
  expect((x * x) % v.n).toBe((y * y) % v.n);
  expect(x).not.toBe(y);
  expect((x + y) % v.n).not.toBe(0n);
});

test('I5: a trivial gcd is reported as a retry, not hidden', async ({ page }) => {
  // Not every N produces one, so this asserts the mechanism EXISTS and is
  // wired to a real counter rather than asserting a particular run hits it.
  const v = V('qs-target');
  await setN(page, v.n);
  await run(page, 'qs');
  const text = await rowFor(page, 'qs').locator('.race-status').innerText();
  const m = text.match(/(\d+) produced a trivial gcd before one split N/);
  expect(m, `the sieve did not report its trivial-gcd count: ${text}`).not.toBeNull();
  expect(Number(m![1])).toBeGreaterThanOrEqual(0);
});

test('every failure path names the actual cause, not a generic error', async ({ page }) => {
  const v = V('close-primes');
  await setN(page, v.n);
  for (const algo of ['trial', 'pminus1', 'pplus1']) {
    await run(page, algo);
    const row = rowFor(page, algo);
    await expect(row).toHaveAttribute('data-state', 'fail');
    const text = await row.locator('.race-status').innerText();
    expect(text).toContain('GAVE UP');
    expect(text.length).toBeGreaterThan(30);
    expect(text).not.toMatch(/error|undefined|NaN/i);
  }
});

test('retirement: changing N discards the verdicts AND says so', async ({ page }) => {
  const a = V('smooth-pminus1');
  const b = V('qs-target');
  await setN(page, a.n);
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');

  await setN(page, b.n);
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#retired-note')).toContainText('Results retired');
  await expect(page.locator('#retired-note')).toContainText(String(a.n));
});

test('no-op guard: re-entering the same N does NOT retire a fresh verdict', async ({ page }) => {
  const a = V('smooth-pminus1');
  await setN(page, a.n);
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');
  await setN(page, a.n); // same value, retyped
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');
  await expect(page.locator('#retired-note')).toHaveCount(0);
});

test('changing a bound retires the board too', async ({ page }) => {
  await setN(page, V('smooth-pminus1').n);
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');
  await page.locator('details.params > summary').click();
  await page.locator('#p-b1').fill('50');
  await page.locator('#p-b1').blur();
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'idle');
  // ...and at the lower bound the same N now resists it.
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'fail');
});

test('edge cases: a prime N, a perfect power, and an even N each say what they are', async ({ page }) => {
  await setN(page, 32416190071n);
  await expect(page.locator('#shape-box')).toContainText('nothing to factor');
  await run(page, 'rho');
  await expect(rowFor(page, 'rho')).not.toHaveAttribute('data-state', 'pass');

  await setN(page, 1000003n ** 2n);
  await expect(page.locator('#shape-box')).toContainText('perfect power');
  await expect(page.locator('#shape-box')).toContainText('1000003^2');

  await setN(page, 704245091749937064n);
  await expect(page.locator('#shape-box')).toContainText('N is even');

  await page.locator('#n-input').fill('not a number');
  await expect(page.locator('#n-input')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#shape-box')).toContainText('decimal integer');
});

test('the recursive tree splits a three-factor N and names each split', async ({ page }) => {
  await setN(page, 446536200662911111n);
  await page.getByRole('button', { name: 'Factor N completely' }).click();
  await expect(page.locator('#tree-out .verdict-pass')).toBeVisible({ timeout: 120_000 });
  const text = await page.locator('#tree-out').innerText();
  const m = text.match(/N = ([\d ×]+)\n/);
  expect(m, `no factorization line: ${text}`).not.toBeNull();
  const leaves = m![1].split('×').map((s) => BigInt(s.trim()));
  expect(leaves.length).toBe(3);
  expect(leaves.reduce((a, b) => a * b, 1n)).toBe(446536200662911111n);
});

/**
 * §4.1d NEGATIVE CLAIM.
 *
 * Claim: obeying every key-generation rule this page teaches does not make N
 * hard to factor — it only removes the methods that need a structure.
 *
 * The fixture: the Weak N Forge's "No structure at all" target. Every check
 * the page performs in that state reports SUCCESS (all four structure-hunting
 * methods correctly gave up, every pill green), and the modulus is factored
 * anyway by the two methods that need no structure.
 */
test('negative claim: every rule obeyed, every check green — and it factors anyway', async ({ page }) => {
  await page.getByRole('tab', { name: 'Weak N Forge' }).click();
  await page.locator('#weak-target').selectOption('none');
  await page.locator('#weak-bits').selectOption('56');
  await page.getByRole('button', { name: 'Forge and prove it' }).click();

  // 1. Reach the fixture.
  await expect(page.locator('#forged-n')).toBeVisible({ timeout: 180_000 });

  // 2. EVERYTHING the page checks in this state reports success — asserted
  //    against the rendered pills, not against a flag this test sets.
  const proof = page.locator('#forge-out table tbody tr');
  await expect(proof).toHaveCount(4);
  await expect(page.locator('#forge-out .pill-ok')).toHaveCount(4);
  await expect(page.locator('#forge-out .pill-bad')).toHaveCount(0);

  // 3. The limitation is ON SCREEN in that state, not in the README.
  const claim = page.locator('#negative-claim-text');
  await expect(claim).toBeVisible();
  await expect(claim).toContainText('does not make N hard to factor');
  await expect(claim).toContainText('Shor');

  // ...and it is a RESULT: the structure-free methods split the same N.
  await expect(page.locator('#negative-claim-evidence .verdict-alarm').first()).toContainText(
    'FACTORED IT ANYWAY',
    { timeout: 180_000 }
  );
  const ev = await page.locator('#negative-claim-evidence').innerText();
  const nText = (await page.locator('#forged-n').innerText()).replace(/\s/g, '');
  const pq = ev.match(/p = (\d+), q = (\d+)/);
  expect(pq, `no recovered factors in the evidence:\n${ev}`).not.toBeNull();
  expect(BigInt(pq![1]) * BigInt(pq![2])).toBe(BigInt(nText));
});

test('the Shor row states plainly that no rule here defends against it', async ({ page }) => {
  await page.getByRole('tab', { name: 'Shor & the RSA Rules' }).click();
  const rows = page.locator('#panel-shor table tbody tr');
  expect(await rows.count()).toBeGreaterThan(6);
  // Every rule row answers "No" to the Shor column, in words.
  const noes = page.locator('#panel-shor .pill-bad');
  expect(await noes.count()).toBe(6);
  await expect(page.locator('#panel-shor .verdict-alarm')).toContainText('None of the six rules');
});

test('the ladder never plots a factor-driven method against the size of N', async ({ page }) => {
  await page.getByRole('tab', { name: 'The Ladder' }).click();
  const axes = await page.locator('.ladder-axis').allInnerTexts();
  expect(axes.length).toBe(7);
  const byName = async (name: string): Promise<string> =>
    page.locator('.ladder-card', { hasText: name }).first().locator('.ladder-axis').innerText();
  expect(await byName('Pollard rho')).toContain('SMALLEST factor');
  expect(await byName('Lenstra ECM')).toContain('SMALLEST factor');
  expect(await byName('Fermat')).toContain('|p - q|');
  expect(await byName('Pollard p-1')).toContain('p - 1');
  expect(await byName('Williams p+1')).toContain('p + 1');
  expect(await byName('Quadratic sieve')).toContain('bits of N');
  // Only the methods that genuinely depend on N share the against-N chart.
  await expect(page.locator('.card', { hasText: 'The only fair' })).toContainText('Shor');
});
