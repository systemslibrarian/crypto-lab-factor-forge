import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { isqrt, isqrtCeil, modinv } from '../src/factor/bigint';
import { factorSmall, largestPrimeFactor } from '../src/factor/primality';
import { DEFAULT_PARAMS } from '../src/factor/types';
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


/**
 * An INDEPENDENT check that a claimed curve order is real.
 *
 * The page computes the order with XZ-only Montgomery arithmetic and a walk
 * along the Hasse interval. Re-deriving it the same way would only prove the
 * page agrees with itself — and it does: a page reporting the wrong order
 * factors the wrong order and every self-consistency check still passes. So
 * this rebuilds the curve from the sigma the page printed and multiplies the
 * base point by the claimed order using AFFINE arithmetic with an explicit
 * point at infinity, which shares no formula with the code under test. If the
 * order is right, [order]P is the identity. If it is off by anything at all,
 * it is not.
 *
 * Curve: B*y^2 = x^3 + A*x^2 + x over F_p, Suyama's parameterisation, with B
 * chosen so the base point is (x, 1).
 */
type Affine = { x: bigint; y: bigint } | null; // null is the point at infinity

function annihilates(sigma: bigint, order: bigint, p: bigint): boolean {
  const mod = (a: bigint): bigint => ((a % p) + p) % p;
  const u = mod(sigma * sigma - 5n);
  const v = mod(4n * sigma);
  const u3 = mod(u * u * u);
  const A = mod(mod(mod((v - u) ** 3n) * mod(3n * u + v)) * modinv(mod(4n * u3 * v), p) - 2n);
  const x = mod(u3 * modinv(mod(v * v * v), p));
  const B = mod(x * x * x + A * x * x + x);

  const add = (P: Affine, Q: Affine): Affine => {
    if (P === null) return Q;
    if (Q === null) return P;
    if (P.x === Q.x && mod(P.y + Q.y) === 0n) return null;
    const lambda =
      P.x === Q.x
        ? mod(mod(3n * P.x * P.x + 2n * A * P.x + 1n) * modinv(mod(2n * B * P.y), p))
        : mod(mod(Q.y - P.y) * modinv(mod(Q.x - P.x), p));
    const x3 = mod(B * lambda * lambda - A - P.x - Q.x);
    return { x: x3, y: mod(lambda * (P.x - x3) - P.y) };
  };

  const P0: Affine = { x, y: 1n };
  let acc: Affine = null;
  let base: Affine = P0;
  let k = order;
  while (k > 0n) {
    if (k & 1n) acc = add(acc, base);
    base = add(base, base);
    k >>= 1n;
  }
  return acc === null;
}

const V = (id: string) => VECTORS.find((v) => v.id === id)!;

async function setN(page: Page, n: bigint): Promise<void> {
  await page.locator('#n-input').fill(String(n));
}

async function run(page: Page, algo: string): Promise<void> {
  const row = page.locator(`.race-row[data-algorithm="${algo}"]`);
  await row.getByRole('button', { name: /^Run( again)?$/ }).click();
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

  // Independent check 1: Hasse's bound on the recovered factor, exactly.
  const p = v.p;
  const root = isqrt(p);
  expect(order).toBeGreaterThanOrEqual(p + 1n - 2n * root);
  expect(order).toBeLessThanOrEqual(p + 1n + 2n * root);

  // Independent check 2, and the one that MATTERS. Rebuild the curve from the
  // sigma the page printed and multiply the base point by the claimed order
  // with affine arithmetic that shares no formula with the code under test.
  const sig = body.match(/sigma\s*\n?\s*(\d+)/);
  expect(sig, `no sigma printed in the trace:\n${body.slice(0, 1200)}`).not.toBeNull();
  expect(
    annihilates(BigInt(sig![1]), order, p),
    'the reported curve order must actually annihilate the base point over F_p'
  ).toBe(true);

  // Independent check 3: the order really is smooth, which is the property
  // ECM's success rests on.
  const independent = factorSmall(order);
  expect(independent, 'the reported curve order must itself be factorable').not.toBeNull();
  const largest = independent!.reduce((acc, f) => (f.prime > acc ? f.prime : acc), 1n);
  expect(
    largest,
    'ECM only succeeds when the curve order is smooth; a wrong order will not be'
  ).toBeLessThanOrEqual(BigInt(DEFAULT_PARAMS.ecmB2));

  // ...and the page's own factorization must agree with the independent one.
  const fac = body.match(new RegExp(`${order} = ([\\d\\s×^]+)`));
  expect(fac, 'the curve order was shown but not factored').not.toBeNull();
  const printed = fac![1]
    .trim()
    .split('×')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((term) => {
      const [b, e] = term.split('^');
      return `${b.trim()}^${e ? e.trim() : '1'}`;
    })
    .join(' ');
  expect(printed).toBe(independent!.map((f) => `${f.prime}^${f.exponent}`).join(' '));
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

/**
 * P0 REGRESSION, measured before the fix: pressing Cancel during the batch
 * terminated the running worker and the loop then launched every remaining
 * method anyway. Four rows published results after cancellation, including a
 * PASS verdict twenty seconds later.
 */
test('cancel stops the batch, and nothing publishes a result afterwards', async ({ page }) => {
  // A 127-bit N with two 64-bit primes: nothing here finds a factor quickly, so
  // the batch is genuinely still running when Cancel is pressed.
  await page.locator('details.params > summary').click();
  await page.locator('#p-rho').fill('50000000');
  await page.locator('#p-rho').blur();
  await page.locator('#p-cap').fill('120000');
  await page.locator('#p-cap').blur();
  await setN(page, 168087653461343538520835907316479739447n);

  await page.getByRole('button', { name: /Run all seven/ }).click();
  await expect(rowFor(page, 'rho')).toHaveAttribute('data-state', 'busy', { timeout: 60_000 });
  await page.locator('#cancel').click();

  const snapshot = await page.locator('.race-row').evaluateAll((rs) =>
    rs.map((r) => (r as HTMLElement).dataset.state)
  );
  // The running row becomes an explicit cancellation, not "not run yet".
  await expect(rowFor(page, 'rho')).toHaveAttribute('data-state', 'cancelled');
  await expect(rowFor(page, 'rho').locator('.pill')).toContainText('CANCELLED');

  // Give the loop every chance to misbehave.
  await page.waitForTimeout(6000);
  const after = await page.locator('.race-row').evaluateAll((rs) =>
    rs.map((r) => (r as HTMLElement).dataset.state)
  );
  expect(after, 'no row may change state after Cancel').toEqual(snapshot);
});

/**
 * P0 REGRESSION, measured before the fix: rho was started on a 127-bit modulus,
 * N was changed to 15 mid-run, and twenty seconds later the board read
 * "rho — GAVE UP: no collision in 50,000,000 iterations" underneath N = 15,
 * where rho finds a factor instantly. The verifier could not catch it: it
 * refutes a mismatched PRODUCT, and a give-up has no product.
 */
test('a run in flight when N changes can never be attributed to the new N', async ({ page }) => {
  await page.locator('details.params > summary').click();
  await page.locator('#p-rho').fill('50000000');
  await page.locator('#p-rho').blur();
  await page.locator('#p-cap').fill('120000');
  await page.locator('#p-cap').blur();
  await setN(page, 168087653461343538520835907316479739447n);
  await rowFor(page, 'rho').getByRole('button', { name: /^Run/ }).click();
  await expect(rowFor(page, 'rho')).toHaveAttribute('data-state', 'busy', { timeout: 60_000 });

  await setN(page, 15n);
  await expect(page.locator('#retired-note')).toContainText('still in flight');
  await expect(page.locator('#retired-note')).toContainText('168087653461343538520835907316479739447');

  await page.waitForTimeout(6000);
  const row = rowFor(page, 'rho');
  await expect(row).not.toHaveAttribute('data-state', 'fail');
  await expect(row).not.toHaveAttribute('data-state', 'pass');
  const text = await row.locator('.race-status').innerText();
  expect(text, 'the old run must not describe the new N').not.toContain('50,000,000');
  await expect(row.locator('.pill')).toContainText('CANCELLED');
});

test('a permalink round-trips the experiment', async ({ page }) => {
  await setN(page, V('safe-primes').n);
  await page.locator('details.params > summary').click();
  await page.locator('#p-b1').fill('777');
  await page.locator('#p-b1').blur();
  await page.getByRole('button', { name: 'Copy permalink' }).click();
  const url = page.url();
  expect(url).toContain(`n=${V('safe-primes').n}`);
  expect(url).toContain('b1=777');

  await page.goto(url);
  await expect(page.locator('#n-input')).toHaveValue(String(V('safe-primes').n));
  await page.locator('details.params > summary').click();
  await expect(page.locator('#p-b1')).toHaveValue('777');
});

test('a permalink carrying an out-of-range bound is rejected, not clamped', async ({ page }) => {
  // A URL is untrusted input: an rhoSteps of 1e12 arriving that way would hang
  // the tab exactly as surely as one typed in, and silently clamping it would
  // make the link mean something different from what it says.
  await page.goto('./?n=1640344808434621&rs=999999999999');
  await expect(page.locator('#url-note')).toBeVisible();
  await expect(page.locator('#url-note')).toContainText('rs=999999999999');
  await page.locator('details.params > summary').click();
  await expect(page.locator('#p-rho')).toHaveValue('3000000');
});

test('an exported run carries the provenance needed to reproduce it', async ({ page }) => {
  await setN(page, V('smooth-pminus1').n);
  await run(page, 'pminus1');
  await expect(rowFor(page, 'pminus1')).toHaveAttribute('data-state', 'pass');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    rowFor(page, 'pminus1').getByRole('button', { name: 'Export run' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  expect(json.schema).toBe('crypto-lab-factor-forge/run@1');
  expect(json.experiment.n).toBe(String(V('smooth-pminus1').n));
  expect(json.experiment.seed).toMatch(/^[0-9a-f]{32}$/);
  expect(json.experiment.params.smoothBound).toBe(10000);
  expect(json.build.commit).toBeTruthy();
  // The verifier's verdict travels WITH the claim, not separately from it.
  expect(json.verdict.status).toBe('verified');
  expect(BigInt(json.result.p) * BigInt(json.result.q)).toBe(V('smooth-pminus1').n);
  // And it says honestly whether the seed reproduces the outcome.
  expect(json.result.cappedByTime).toBe(false);
  expect(json.reproducibility).toContain('reproduces this outcome exactly');
});

/**
 * Count integrity. Prose that states a number drifts from the thing it counts;
 * the fix was to derive every count, and this asserts the derivation agrees
 * with what is rendered.
 */
test('every count on the page agrees with the thing it counts', async ({ page }) => {
  // The meta description names the methods it counts.
  const desc = await page.locator('meta[name="description"]').getAttribute('content');
  const rows = await page.locator('.race-row').count();
  expect(desc).toContain('Seven classical integer factoring');
  expect(rows).toBe(7);

  await page.getByRole('tab', { name: 'The Ladder' }).click();
  const cards = await page.locator('.ladder-card').count();
  expect(cards).toBe(rows);

  // "These N are the methods whose cost genuinely is a function of N" must equal
  // the number of series actually drawn on that chart. It said four beside a
  // chart carrying three.
  const countText = await page.locator('#against-n-count').innerText();
  const stated = Number(countText.match(/These (\d+) are/)![1]);
  const listed = countText.split(':')[1].split('.')[0].split(',').length;
  expect(stated).toBe(listed);

  const legend = await page.locator('#ladder-legend').innerText();
  const methods = Number(legend.match(/(\d+) methods/)![1]);
  const drivers = Number(legend.match(/(\d+) distinct drivers/)![1]);
  expect(methods).toBe(cards);
  const axes = await page.locator('.ladder-axis').allInnerTexts();
  const distinct = new Set(axes.map((a) => a.split(' vs ')[1])).size;
  expect(drivers).toBe(distinct);
});

test('a run stopped by its cap is not presented as a timing', async ({ page }) => {
  await setN(page, V('close-primes').n);
  await page.locator('details.params > summary').click();
  // The STEP cap must be raised out of the way first, or whichever cap the
  // engine reaches first decides the outcome -- and it differs by engine. This
  // test is about the wall-clock cap, so make that the only one reachable.
  await page.locator('#p-rho').fill('50000000');
  await page.locator('#p-rho').blur();
  await page.locator('#p-cap').fill('300');
  await page.locator('#p-cap').blur();
  await run(page, 'rho');
  const time = rowFor(page, 'rho').locator('.race-time');
  await expect(time).toHaveText(/^cap /);
  await expect(time).toHaveClass(/race-time-capped/);
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
  await expect(page.locator('#retired-note')).toContainText('under the previous bounds');
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
  // "p ± 1", because which group caught it is decided by a computed Legendre
  // symbol at run time, not assumed -- see pplus1.ts.
  expect(await byName('Williams p+1')).toContain('p ± 1');
  expect(await byName('Quadratic sieve')).toContain('bits of N');
  // Only the methods that genuinely depend on N share the against-N chart.
  await expect(page.locator('.card', { hasText: 'The only fair' })).toContainText('Shor');
});

/**
 * WCAG 2.4.3 Focus Order (Level A).
 *
 * Every panel rebuilds its DOM from the store on each state change, which is
 * what keeps the rendering and the state impossible to disagree. Measured
 * before the fix: pressing Enter on a board Run button destroyed that button
 * and `document.activeElement` fell back to `<body>`, so a keyboard reader was
 * thrown to the top of the document every time they ran anything and had to Tab
 * all the way back to run the next one. No axe scan can see this -- it is a
 * property of the transition between two renders, and axe only ever sees one.
 */
test('keyboard focus survives every re-render', async ({ page }) => {
  const active = (): Promise<string> =>
    page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'BODY';
      return `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}|${(a.textContent ?? '').trim().slice(0, 24)}`;
    });

  // A board Run button: the row it lives in is rebuilt twice, once when the run
  // starts and once when it finishes.
  await page.locator('.race-row[data-algorithm="trial"] button[data-run]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.race-row[data-algorithm="trial"] .race-time')).toBeVisible({
    timeout: 120_000,
  });
  expect(await active(), 'focus must not fall to body after a row re-renders').not.toBe('BODY');
  expect(await active()).toContain('Run again');

  // The batch button, which becomes unavailable the instant it is pressed.
  await page.locator('#run-all').focus();
  await page.keyboard.press('Enter');
  expect(await active(), 'focus must survive the batch button going unavailable').toContain('run-all');

  // The Trace stepper rebuilds the entire panel on every click, including at
  // the end of the trace where Next becomes unavailable.
  await page.getByRole('tab', { name: 'Trace' }).click();
  await page.locator('#trace-next').focus();
  await page.keyboard.press('Enter');
  expect(await active()).toContain('trace-next');
  await page.getByRole('button', { name: 'Show all steps' }).click();
  await page.locator('#trace-next').focus();
  expect(await active()).toContain('trace-next');
  // ...and it is unavailable via aria-disabled, NOT the `disabled` attribute,
  // because a `disabled` replacement cannot take focus back at all.
  await expect(page.locator('#trace-next')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#trace-next')).not.toHaveAttribute('disabled', /.*/);
});

/**
 * WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum), Level AA. The shared top bar
 * is `position: sticky` and 65px tall, so a focused element scrolled into view
 * could land underneath it.
 */
test('a focused element is never hidden behind the sticky bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('.');
  const obscured: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const hit = await page.evaluate(async () => {
      const a = document.activeElement as HTMLElement | null;
      const bar = document.querySelector('.cl-topbar');
      if (!a || a === document.body || !bar) return null;
      // The bar's own controls sit inside it and are not obscured BY it.
      if (bar.contains(a)) return null;

      // Measure only once the focused element has stopped moving. The skip link
      // animates `top` from -3rem to 0 over 150ms on :focus, so a rect read
      // straight after the Tab catches it mid-flight. That is the whole of the
      // `a top=-31 bar=65` failure seen on CI: -31 is neither the resting
      // position nor the hidden one, it is a frame between the two. The same
      // test passed locally because a faster round-trip read it at -48, before
      // the transition had started. Both readings were of a value in motion.
      const settled = await new Promise<DOMRect>((resolve) => {
        let last = a.getBoundingClientRect();
        let still = 0;
        const tick = () => {
          const now = a.getBoundingClientRect();
          still = Math.abs(now.top - last.top) < 0.5 && Math.abs(now.left - last.left) < 0.5 ? still + 1 : 0;
          last = now;
          if (still >= 3) resolve(now);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      if (settled.height === 0 || settled.width === 0) return null;

      const b = bar.getBoundingClientRect();
      if (!(settled.top < b.bottom && settled.bottom > b.top)) return null;

      // Sharing the bar's rectangle is not the same as being hidden by it. The
      // skip link is positioned over the bar on purpose and paints in front of
      // it (z-index 1001 against the bar's 1000), so a box comparison calls a
      // fully visible control obscured. SC 2.4.11 is about what the user can
      // actually see, so ask the renderer which element is in front instead.
      // Points are inset 12px because the skip link's 10px bottom radius puts
      // its own corners outside its box, where the hit test reads through.
      const inset = 12;
      const xs = [settled.left + inset, settled.left + settled.width / 2, settled.right - inset];
      const ys = [settled.top + inset, settled.top + settled.height / 2, settled.bottom - inset];
      const samples: { x: number; y: number }[] = [];
      for (const x of xs) for (const y of ys) {
        if (y >= b.top && y <= b.bottom) samples.push({ x, y });
      }
      if (samples.length === 0) return null;

      const covered = samples.filter(({ x, y }) => {
        // Off the viewport is not "in front of", it is worse: nothing to see.
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true;
        const front = document.elementFromPoint(x, y);
        if (!front) return true;
        if (front === a || a.contains(front) || front.contains(a)) return false;
        return front === bar || bar.contains(front);
      });

      return covered.length > 0
        ? `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''} top=${Math.round(settled.top)} bar=${Math.round(b.bottom)} covered=${covered.length}/${samples.length}`
        : null;
    });
    if (hit) obscured.push(hit);
  }
  expect(obscured, 'focused controls hidden behind the sticky top bar').toEqual([]);
});

/**
 * Mobile: no horizontal scrolling at the narrowest width anyone still designs
 * for, on any tab. SC 1.4.10 Reflow is specified at 320 CSS px.
 */
test('nothing scrolls sideways at 320px, on any tab', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('.');
  const overflow = async (): Promise<number> =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), 'Factor N').toBe(0);
  for (const name of ['Weak N Forge', 'Trace', 'The Ladder', 'Shor']) {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    expect(await overflow(), name).toBe(0);
  }
});

/**
 * iOS Safari zooms the whole page when a control smaller than 16px takes focus,
 * and does not zoom back out. Every input here was 14.4px, so tapping the field
 * this page is built around threw the layout off and left the reader to pinch
 * back. Not a WCAG failure; a loud mobile usability one.
 */
test('form controls are 16px on touch, so iOS does not auto-zoom', async ({ page }) => {
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('input, textarea, select')].map(
      (e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}=${getComputedStyle(e).fontSize}`
    )
  );
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (!coarse) {
    // Desktop keeps its density; the rule is scoped to coarse pointers.
    expect(sizes.length).toBeGreaterThan(0);
    return;
  }
  const small = sizes.filter((s) => parseFloat(s.split('=')[1]) < 16);
  expect(small, 'controls below 16px trigger iOS auto-zoom on focus').toEqual([]);
});

/** Pinch-zoom must not be blocked (SC 1.4.4 Resize Text). */
test('the viewport meta does not block zooming', async ({ page }) => {
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('width=device-width');
  expect(content).not.toContain('user-scalable=no');
  expect(content).not.toMatch(/maximum-scale\s*=\s*[12](\.0)?\b/);
});

/**
 * WCAG 2.1 SC 4.1.3 Status Messages (Level AA).
 *
 * A run's verdict is the entire product of this page and it was delivered
 * silently. Measured before the fix: a seven-run batch produced 8,508 DOM
 * mutations inside `#board` and ZERO inside any live region, because `#board`
 * is `role="list"` and nothing else on the page was live. A screen-reader user
 * pressing Run heard nothing -- not that it started, not that it finished, not
 * what it found.
 */
test('every terminal run state is announced, and progress is not', async ({ page }) => {
  const announcer = page.locator('#announcer');
  await expect(announcer).toHaveAttribute('role', 'status');
  await expect(announcer).toHaveAttribute('aria-live', 'polite');
  await expect(announcer).toHaveAttribute('aria-atomic', 'true');

  // A win names the method, the timing and the recovered factors.
  await setN(page, V('smooth-pminus1').n);
  await run(page, 'pminus1');
  await expect(announcer).toContainText('Pollard p-1 factored it');
  const text = await announcer.innerText();
  const m = text.match(/p is (\d+), q is (\d+)/);
  expect(m, `no factors announced: ${text}`).not.toBeNull();
  expect(BigInt(m![1]) * BigInt(m![2])).toBe(V('smooth-pminus1').n);

  // A give-up is announced too -- on this page that is a result, not a silence.
  await run(page, 'trial');
  await expect(announcer).toContainText('Trial division gave up');

  // Progress is deliberately NOT announced: a long rho run emits thousands of
  // updates and piping those into a live region replaces silence with a flood.
  await page.locator('details.params > summary').click();
  await page.locator('#p-rho').fill('50000000');
  await page.locator('#p-rho').blur();
  await page.locator('#p-cap').fill('120000');
  await page.locator('#p-cap').blur();
  await setN(page, 168087653461343538520835907316479739447n);
  await rowFor(page, 'rho').getByRole('button', { name: /^Run/ }).click();
  await expect(rowFor(page, 'rho')).toHaveAttribute('data-state', 'busy', { timeout: 60_000 });
  const during = await announcer.innerText();
  await page.waitForTimeout(1500);
  await expect(rowFor(page, 'rho').locator('.progress')).toContainText('%');
  expect(await announcer.innerText(), 'progress must not be announced').toBe(during);

  // Cancellation IS announced.
  await page.locator('#cancel').click();
  await expect(announcer).toContainText('cancelled');
});

test('a batch announces its start and a summary of what won', async ({ page }) => {
  await setN(page, V('qs-target').n);
  await page.getByRole('button', { name: /Run all seven/ }).click();
  const announcer = page.locator('#announcer');
  await expect(announcer).toContainText('finished', { timeout: 180_000 });
  const text = await announcer.innerText();
  const m = text.match(/(\d+) factored this N: (.+)\./);
  expect(m, `no batch summary: ${text}`).not.toBeNull();
  // The summary must agree with the board rather than being written separately.
  const passes = await page.locator('.race-row[data-state="pass"]').count();
  expect(Number(m![1])).toBe(passes);
});

test('retiring the board is announced, not just repainted', async ({ page }) => {
  await setN(page, V('smooth-pminus1').n);
  await run(page, 'pminus1');
  await setN(page, V('qs-target').n);
  await expect(page.locator('#announcer')).toContainText('were discarded');
  await expect(page.locator('#announcer')).toContainText(String(V('smooth-pminus1').n));
});

/** The one field this lab is built around takes digits only. */
test('the N field asks a phone for a numeric keyboard', async ({ page }) => {
  await expect(page.locator('#n-input')).toHaveAttribute('inputmode', 'numeric');
});

/**
 * Landmark navigation is a real screen-reader workflow, and the page's own name
 * and description sat outside every landmark.
 */
test('all content is inside a landmark, with exactly one banner and one main', async ({ page }) => {
  const landmarks = await page.evaluate(() => {
    const sel = 'header,[role=banner],main,[role=main],nav,[role=navigation],aside,[role=complementary],[role=region][aria-label],footer,[role=contentinfo]';
    return [...document.querySelectorAll(sel)].map(
      (e) => `${e.tagName.toLowerCase()}[${e.getAttribute('role') ?? 'implicit'}]="${e.getAttribute('aria-label') ?? ''}"`
    );
  });
  expect(landmarks.filter((l) => l.includes('banner')).length).toBe(1);
  expect(landmarks.filter((l) => l.startsWith('main')).length).toBe(1);
  // The hero carries the h1 and must be reachable by landmark navigation.
  expect(landmarks.some((l) => l.includes('About this lab'))).toBe(true);
  // ...and no complementary nested inside another landmark.
  const nested = await page.evaluate(() =>
    [...document.querySelectorAll('aside,[role=complementary]')].filter((e) =>
      e.parentElement?.closest('main,[role=main],[role=region],nav,header,[role=banner],footer,[role=contentinfo]')
    ).length
  );
  expect(nested).toBe(0);
});

// Corpus claims deliberately use no implementation imports: Euclid, square-and-
// multiply and Miller–Rabin are written here from the public values on screen.
const corpusGcd=(a:bigint,b:bigint):bigint=>{while(b)[a,b]=[b,a%b];return a;};
const corpusPow=(a:bigint,e:bigint,n:bigint):bigint=>{let r=1n;while(e){if(e&1n)r=r*a%n;a=a*a%n;e>>=1n;}return r;};
function corpusPrime(n:bigint):boolean{
  if(n<2n)return false;for(const p of [2n,3n,5n,7n,11n,13n,17n,19n,23n]){if(n===p)return true;if(n%p===0n)return false;}
  let d=n-1n,s=0;while(!(d&1n)){d>>=1n;s++;}
  for(const a of [2n,3n,5n,7n,11n,13n,17n,19n,23n]){
    let x=corpusPow(a,d,n);if(x===1n||x===n-1n)continue;let hit=false;
    for(let r=1;r<s;r++){x=x*x%n;if(x===n-1n){hit=true;break;}}if(!hit)return false;
  }return true;
}
async function corpusGenerate(page:Page,query=''):Promise<void>{
  await page.goto(`?tab=corpus${query}`);await page.locator('#corpus-generate').click();
  await expect(page.locator('#corpus-status')).toContainText('Corpus ready',{timeout:120000});
}
async function corpusAttack(page:Page):Promise<void>{
  await page.locator('#corpus-batch').click();await expect(page.locator('#corpus-status')).toContainText('Batch GCD completed',{timeout:120000});
}
async function corpusCheck(page:Page):Promise<bigint[]>{
  const ns=(await page.locator('[data-modulus]').allTextContents()).map(BigInt),p=ns.reduce((a,b)=>a*b,1n);
  for(let i=0;i<ns.length;i++){
    const sharing=ns.flatMap((n,j)=>i!==j&&corpusGcd(ns[i],n)>1n?[j]:[]);
    await expect(page.locator(`[data-shares="${i}"]`)).toHaveText(sharing.length?sharing.join(', '):'none');
    const raw=corpusGcd(ns[i],p/ns[i]);await expect(page.locator(`[data-raw-gcd="${i}"]`)).toContainText(`g${i} = ${raw}`);
    const expected=ns.some((n,j)=>i!==j&&corpusGcd(ns[i],n)>1n&&corpusGcd(ns[i],n)<ns[i]);
    await expect(page.locator(`[data-key="${i}"]`)).toHaveAttribute('data-compromised',String(expected));
    const f=page.locator(`[data-factor="${i}"]`);
    if(expected){const factor=BigInt((await f.textContent())!);expect(ns[i]%factor).toBe(0n);expect(corpusPrime(factor)).toBe(true);expect(corpusPrime(ns[i]/factor)).toBe(true);await expect(page.locator(`[data-verified="${i}"]`)).toContainText('VERIFIED: p × q = N');await expect(page.locator(`[data-key="${i}"]`)).toHaveClass('verdict verdict-alarm');}
    else {await expect(f).toHaveCount(0);await expect(page.locator(`[data-key="${i}"]`)).toHaveClass('verdict verdict-idle');}
  }
  let level=0,row=ns.slice();
  while(true){
    const rendered=await page.locator(`[data-tree="product"][data-level="${level}"] [data-bits]`).evaluateAll(es=>es.map(e=>Number(e.getAttribute('data-bits'))));expect(rendered).toEqual(row.map(n=>n.toString(2).length));
    const remainders=await page.locator(`[data-tree="remainder"][data-level="${level}"] [data-bits]`).evaluateAll(es=>es.map(e=>Number(e.getAttribute('data-bits'))));expect(remainders).toEqual(row.map(n=>{const r=p%(n*n);return r===0n?0:r.toString(2).length;}));
    if(row.length===1)break;const next=[];for(let i=0;i<row.length;i+=2)next.push(row[i]*(row[i+1]??1n));row=next;level++;
  }
  const sum=ns.reduce((s,n)=>s+n.toString(2).length,0),root=p.toString(2).length;expect(root).toBeLessThanOrEqual(sum);expect(root).toBeGreaterThan(sum-ns.length);
  return ns;
}

test('corpus public GCD transcript and verified recovery independently match all moduli',async({page})=>{
  await corpusGenerate(page);await corpusAttack(page);const ns=await corpusCheck(page);expect(ns.length).toBe(64);
  await page.locator('#corpus-naive').click();await expect(page.locator('#corpus-status')).toContainText('2016 pairwise comparisons');await expect(page.locator('#corpus-status')).toContainText('Both routes agree');
  const before=await page.locator('#corpus-results').textContent();await page.locator('#corpus-entropy').dispatchEvent('input');expect(await page.locator('#corpus-results').textContent()).toBe(before);
  await page.locator('#corpus-entropy').fill('11');await page.locator('#corpus-entropy').dispatchEvent('input');await expect(page.locator('#corpus-results')).toBeEmpty();await expect(page.locator('#corpus-status')).toContainText('retired');
});

test('corpus observed collisions follow the seeded prime model and independent public GCDs',async({page})=>{
  await corpusGenerate(page,'&ck=12&cs=3&cseed=c0ffee');await corpusAttack(page);await corpusCheck(page);
  // This seed's 12-key graph is pinned by the generator test, independently of
  // prime size. Fresh unseeded primes destroy it even if seed counters lie.
  await expect(page.locator('[data-compromised="true"]')).toHaveCount(12);
  await expect(page.locator('#corpus-observed')).toContainText('Observed seed-draw collision pairs:');
});

test('corpus negative claim coexists with four bounded give-ups and a verified factor',async({page})=>{
  await corpusGenerate(page);await corpusAttack(page);await page.locator('#corpus-audit').click();await expect(page.locator('#corpus-status')).toContainText('Four bounded',{timeout:120000});
  for(const id of ['trial','fermat','pminus1','pplus1'])await expect(page.locator(`[data-audit="${id}"]`)).toContainText('GAVE UP');
  await expect(page.locator('#corpus-shape')).toContainText('Not a perfect power');
  const i=await page.locator('#corpus-victim').inputValue(),n=BigInt((await page.locator(`[data-modulus="${i}"]`).textContent())!),factor=BigInt((await page.locator(`[data-factor="${i}"]`).textContent())!);
  expect(n%factor).toBe(0n);expect(corpusPrime(factor)).toBe(true);
  await expect(page.locator('#corpus-negative-fixture .verdict-alarm')).toContainText('BOUNDED PER-KEY SEARCHES GAVE UP — AND FACTORED');
  await expect(page.locator('#corpus-negative')).toBeVisible();await expect(page.locator('#corpus-negative')).toHaveText('The four bounded per-key searches found no factor, yet the same public key was factored by the corpus. Giving up is not a certificate of security.');
});

test('corpus no-collision repeated-modulus budget and cancellation paths stay honest',async({page})=>{
  await corpusGenerate(page,'&ck=8&cs=24');await corpusAttack(page);await corpusCheck(page);await expect(page.locator('[data-compromised="true"]')).toHaveCount(0);
  await corpusGenerate(page,'&ck=4&cs=1');await corpusAttack(page);await corpusCheck(page);await expect(page.locator('#corpus-results')).toContainText('The same key twice');await expect(page.locator('[data-compromised="true"]')).toHaveCount(0);
  await page.locator('#corpus-count').fill('129');await page.locator('#corpus-generate').click();await expect(page.locator('#corpus-status')).toContainText('CORPUS_BUDGET');
  await page.locator('#corpus-count').fill('128');await page.locator('#corpus-bits').selectOption('1024');await page.locator('#corpus-entropy').fill('24');await page.locator('#corpus-entropy').dispatchEvent('input');
  await page.locator('#corpus-generate').click();await page.locator('#corpus-cancel').click();await expect(page.locator('#corpus-status')).toContainText('Cancelled');await expect(page.locator('[data-compromised="true"]')).toHaveCount(0);await expect(page.locator('#corpus-batch')).toBeDisabled();
  await corpusGenerate(page,'&ck=8&cs=3');
  // A user cancellation is triggered at the first real product-level render.
  // No worker result, modulus, or verdict is mocked.
  await page.evaluate(()=>{const box=document.querySelector('#corpus-trees')!;const observer=new MutationObserver(()=>{if(box.querySelector('[data-tree="product"]')){observer.disconnect();(document.querySelector('#corpus-cancel') as HTMLButtonElement).click();}});observer.observe(box,{childList:true,subtree:true});});
  await page.locator('#corpus-batch').click();await expect(page.locator('#corpus-status')).toContainText('Cancelled');await expect(page.locator('#corpus-trees')).toContainText('cancelled, partial levels');await expect(page.locator('[data-factor]')).toHaveCount(0);
});

test('corpus export and permalink carry the whole experiment and invalid URLs are refused',async({page})=>{
  await corpusGenerate(page,'&ck=4&cs=3&cb=512&cseed=1234');await corpusAttack(page);
  const downloadPromise=page.waitForEvent('download');await page.locator('#corpus-export').click();const download=await downloadPromise,stream=await download.createReadStream();let text='';for await(const chunk of stream!)text+=chunk.toString();const record=JSON.parse(text);
  expect(record.context).toEqual({K:4,s:3,bits:512,seed:'1234'});expect(record.build.commit).toMatch(/^[0-9a-f]{40}$/);expect(record.generated.moduli).toHaveLength(4);
  expect(record.generated.moduli.every((n:string)=>[1023,1024].includes(BigInt(n).toString(2).length))).toBe(true);
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as unknown as {copied:string}).copied=text;}}});});
  await page.locator('#corpus-link').click();const link=await page.evaluate(()=>(window as unknown as {copied:string}).copied),url=new URL(link);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({tab:'corpus',ck:'4',cs:'3',cb:'512',cseed:'1234',cbuild:record.build.commit});
  await page.goto('?tab=corpus&cs=99&ck=999&cb=9&cseed=oops');await expect(page.locator('#corpus-status')).toContainText('Rejected invalid corpus permalink fields');await expect(page.locator('#corpus-entropy')).toHaveValue('10');
});

// Mutation-only transport check: a stale served script is inconclusive, never a kill.
test.afterEach(async({page})=>{
 if(process.env.MUTATION_ASSETS){
  const expected=JSON.parse(process.env.MUTATION_ASSETS) as Record<string,string>;
  const src=await page.locator('script[type="module"]').getAttribute('src');
  const response=await page.request.get(src!),digest=createHash('sha256').update(await response.body()).digest('hex');
  if(expected[src!.split('/').at(-1)!]!==digest)throw new Error('MUTATION_ASSET_MISMATCH: served script differs from the built artifact');
 }
});
