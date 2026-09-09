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
  expect(await byName('Williams p+1')).toContain('p + 1');
  expect(await byName('Quadratic sieve')).toContain('bits of N');
  // Only the methods that genuinely depend on N share the against-N chart.
  await expect(page.locator('.card', { hasText: 'The only fair' })).toContainText('Shor');
});
