/**
 * The quadratic sieve (single polynomial, small factor base).
 *
 * This is the one method here that exploits NOTHING about p or q. It does not
 * care whether a factor is small, whether p - 1 is smooth, or whether p and q
 * are close. It looks for x with x^2 = y^2 (mod N) and x != +/- y, because
 * then N divides (x - y)(x + y) while dividing neither factor, so
 * gcd(x - y, N) is proper. Its cost is L_N[1/2, 1] -- driven by the size of N
 * itself, which is why "make the modulus bigger" is the only defence that
 * works against it, and why the number field sieve (L_N[1/3, 1.92]) is the
 * one that actually threatens RSA.
 *
 * The relations come from Q(x) = (ceil(sqrt(N)) + x)^2 - N, sieved for values
 * that factor completely over a small factor base. A GF(2) dependency among
 * their exponent vectors makes the product of those Q values a perfect square.
 *
 * Pomerance, "The quadratic sieve factoring algorithm", EUROCRYPT 84,
 * LNCS 209, 169-182.
 */

import { gcd, isqrtCeil, jacobi, primesBelow, sqrtMod, isqrt } from './bigint';
import { gaveUp, type Budget, type FactorOutcome, type Params, type TraceStep } from './types';

export interface Relation {
  /** The sieve offset. */
  x: number;
  /** ceil(sqrt(N)) + x. */
  root: bigint;
  /** Q(x) = root^2 - N. */
  q: bigint;
  /** Full exponents over the factor base, index 0 being the sign. */
  exponents: number[];
}

/** Exponent vector over the factor base, or null if Q(x) is not smooth. */
export function smoothVector(q: bigint, factorBase: number[]): number[] | null {
  const exps = new Array(factorBase.length + 1).fill(0);
  let m = q;
  if (m < 0n) {
    exps[0] = 1;
    m = -m;
  }
  for (let i = 0; i < factorBase.length; i++) {
    const p = BigInt(factorBase[i]);
    while (m % p === 0n) {
      m /= p;
      exps[i + 1]++;
    }
    if (m === 1n) return exps;
  }
  return m === 1n ? exps : null;
}

/**
 * Null-space basis of the GF(2) matrix (rows = relations, columns = primes).
 * Plain Gaussian elimination -- the matrices this lab builds are tiny and the
 * point is that the step is visible, not that it is fast.
 */
export function gf2NullSpace(rows: number[][], cols: number): number[][] {
  const m = rows.length;
  // Augment each row with an identity block so the combination that produced
  // each reduced row is carried along with it.
  const work = rows.map((r, i) => {
    const id = new Array(m).fill(0);
    id[i] = 1;
    return [...r.slice(0, cols), ...id];
  });

  let pivotRow = 0;
  const pivotCols: number[] = [];
  for (let c = 0; c < cols && pivotRow < m; c++) {
    let sel = -1;
    for (let r = pivotRow; r < m; r++) {
      if (work[r][c] === 1) {
        sel = r;
        break;
      }
    }
    if (sel === -1) continue;
    [work[pivotRow], work[sel]] = [work[sel], work[pivotRow]];
    for (let r = 0; r < m; r++) {
      if (r !== pivotRow && work[r][c] === 1) {
        for (let k = c; k < cols + m; k++) work[r][k] ^= work[pivotRow][k];
      }
    }
    pivotCols.push(c);
    pivotRow++;
  }

  const deps: number[][] = [];
  for (let r = 0; r < m; r++) {
    const isZero = work[r].slice(0, cols).every((v) => v === 0);
    if (isZero) deps.push(work[r].slice(cols));
  }
  return deps;
}

export function factorQS(n: bigint, params: Params, budget: Budget): FactorOutcome {
  const t0 = performance.now();
  const steps: TraceStep[] = [];
  const B = params.qsFactorBaseBound;
  const M = params.qsSieveRadius;

  if ((n & 1n) === 0n) {
    return {
      p: 2n,
      q: n / 2n,
      ms: performance.now() - t0,
      trace: {
        algorithm: 'qs',
        steps: [{ label: 'N is even', detail: 'The sieve needs odd N; the factor 2 is peeled off first.', pivotal: true }],
        metrics: [{ key: 'relations', value: '0' }],
        why: { kind: 'small-factor', factor: '2', divisions: 1 },
        gaveUp: null,
      },
    };
  }

  // ── The factor base: only primes for which N is a quadratic residue ─────
  const factorBase: number[] = [2];
  for (const p of primesBelow(B + 1)) {
    if (p === 2) continue;
    if (n % BigInt(p) === 0n) {
      // A factor base prime dividing N is itself the answer.
      const d = BigInt(p);
      return {
        p: d,
        q: n / d,
        ms: performance.now() - t0,
        trace: {
          algorithm: 'qs',
          steps: [
            {
              label: 'A factor-base prime divides N',
              detail: `Building the factor base found ${p} | N outright. The sieve never had to run.`,
              pivotal: true,
            },
          ],
          metrics: [{ key: 'relations', value: '0' }],
          why: { kind: 'small-factor', factor: String(p), divisions: factorBase.length },
          gaveUp: null,
        },
      };
    }
    if (jacobi(n, BigInt(p)) === 1) factorBase.push(p);
  }

  const target = factorBase.length + 8;
  steps.push({
    label: 'Build the factor base',
    detail:
      'Only primes p for which N is a quadratic residue can ever divide Q(x) = (m+x)^2 - N. Half of all primes are thrown away before a single sieve step, by a Legendre symbol.',
    values: [
      { key: 'bound B', value: B.toLocaleString() },
      { key: 'factor base size', value: String(factorBase.length) },
      { key: 'first primes', value: factorBase.slice(0, 10).join(', ') },
      { key: 'relations needed', value: String(target) },
    ],
  });

  if (factorBase.length < 12) {
    steps.push({
      label: 'Factor base too small',
      detail: 'Fewer than a dozen usable primes: there is no chance of enough smooth values. Raise B.',
    });
    return gaveUp('qs', steps, [{ key: 'factor base', value: String(factorBase.length) }], `factor base of ${factorBase.length} primes is too small for this N -- raise B`, 'setup', performance.now() - t0);
  }

  // ── Sieve ──────────────────────────────────────────────────────────────
  const m0 = isqrtCeil(n);
  const size = 2 * M + 1;
  const logs = new Float32Array(size);
  for (let i = 0; i < factorBase.length; i++) {
    const p = factorBase[i];
    const lp = Math.log(p);
    const r = sqrtMod(n, BigInt(p));
    if (r === null) continue;
    const roots = p === 2 ? [r] : [r, (BigInt(p) - r) % BigInt(p)];
    for (const rt of roots) {
      // (m0 + x)^2 = N (mod p)  =>  x = rt - m0 (mod p)
      let start = Number(((rt - m0) % BigInt(p) + BigInt(p)) % BigInt(p)) - M;
      start = ((start % p) + p) % p;
      for (let idx = start; idx < size; idx += p) logs[idx] += lp;
    }
    if ((i & 0x3f) === 0 && performance.now() - t0 > budget.maxMs) {
      return gaveUp('qs', steps, [{ key: 'factor base', value: String(factorBase.length) }], 'time cap reached', 'sieving', performance.now() - t0);
    }
  }

  const relations: Relation[] = [];
  const approxLog = Number(isqrt(n).toString().length) * Math.log(10) + Math.log(M + 1);
  const threshold = approxLog - 2.2 * Math.log(factorBase[factorBase.length - 1]);
  let candidates = 0;
  for (let idx = 0; idx < size && relations.length < target; idx++) {
    if (logs[idx] < threshold) continue;
    candidates++;
    const x = idx - M;
    const root = m0 + BigInt(x);
    const q = root * root - n;
    if (q === 0n) continue;
    const exps = smoothVector(q, factorBase);
    if (exps) relations.push({ x, root, q, exponents: exps });
    if ((candidates & 0x3ff) === 0) {
      if (budget.cancelled?.()) {
        return gaveUp('qs', steps, qsMetrics(factorBase.length, relations.length), 'cancelled', 'collecting relations', performance.now() - t0);
      }
      if (performance.now() - t0 > budget.maxMs) {
        return gaveUp('qs', steps, qsMetrics(factorBase.length, relations.length), 'time cap reached', 'collecting relations', performance.now() - t0);
      }
      budget.onProgress?.(relations.length, target, `${relations.length} relations`);
    }
  }

  steps.push({
    label: 'Sieve for smooth Q(x)',
    detail:
      'Adding log p at every position where p divides Q(x) costs one pass per prime instead of one division per value. Positions whose running total nearly reaches log Q(x) are the smooth candidates, and only those get divided out exactly.',
    values: [
      { key: 'interval', value: `x in [-${M.toLocaleString()}, ${M.toLocaleString()}]` },
      { key: 'candidates above threshold', value: candidates.toLocaleString() },
      { key: 'fully smooth relations', value: String(relations.length) },
    ],
  });

  if (relations.length < 4) {
    steps.push({
      label: 'Not enough relations',
      detail: 'Too few smooth values in this interval. Widen the sieve radius or raise the factor-base bound.',
    });
    return gaveUp(
      'qs',
      steps,
      qsMetrics(factorBase.length, relations.length),
      `only ${relations.length} relations found -- widen the sieve interval or raise B`,
      'collecting relations',
      performance.now() - t0
    );
  }

  // ── The GF(2) matrix ───────────────────────────────────────────────────
  const cols = factorBase.length + 1;
  const matrix = relations.map((r) => r.exponents.map((e) => e & 1));
  const deps = gf2NullSpace(matrix, cols);
  steps.push({
    label: 'Find a dependency mod 2',
    detail:
      'Each relation is a vector of exponent parities. A subset summing to the zero vector means the product of those Q(x) has every prime to an EVEN power -- a perfect square. Gaussian elimination over GF(2) finds those subsets.',
    values: [
      { key: 'matrix', value: `${relations.length} rows x ${cols} columns` },
      { key: 'dependencies found', value: String(deps.length) },
      { key: 'first rows (parity bits)', value: matrixPreview(matrix) },
    ],
  });

  if (deps.length === 0) {
    // With fewer relations than columns the matrix simply has no null space
    // yet. That is a shortage of relations, not a failure of the method, and
    // the message says which.
    return gaveUp(
      'qs',
      steps,
      qsMetrics(factorBase.length, relations.length),
      `${relations.length} relations against ${cols} columns is not enough for a dependency -- widen the sieve interval or raise B`,
      'linear algebra',
      performance.now() - t0
    );
  }

  // ── Turn dependencies into gcds ────────────────────────────────────────
  let trivial = 0;
  for (const dep of deps) {
    const picked = relations.filter((_, i) => dep[i] === 1);
    if (picked.length === 0) continue;
    let xProd = 1n;
    const totals = new Array(cols).fill(0);
    for (const r of picked) {
      xProd = (xProd * r.root) % n;
      for (let i = 0; i < cols; i++) totals[i] += r.exponents[i];
    }
    if (totals.some((t) => t % 2 !== 0)) continue; // not actually a square
    let yProd = 1n;
    for (let i = 1; i < cols; i++) {
      if (totals[i] === 0) continue;
      let base = BigInt(factorBase[i - 1]);
      let e = totals[i] / 2;
      // square-and-multiply on the half exponent
      let acc = 1n;
      while (e > 0) {
        if (e & 1) acc = (acc * base) % n;
        base = (base * base) % n;
        e >>= 1;
      }
      yProd = (yProd * acc) % n;
    }
    const g = gcd(((xProd - yProd) % n + n) % n, n);
    if (g > 1n && g < n) {
      const p = g < n / g ? g : n / g;
      const qq = n / p;
      steps.push({
        label: 'x^2 = y^2 (mod N) with x != +/- y',
        detail:
          'N divides (x - y)(x + y) but divides neither factor, so the gcd splits it. Nothing about p or q was ever used -- only the size of N decided how long this took.',
        values: [
          { key: 'relations combined', value: String(picked.length) },
          { key: 'x mod N', value: String(xProd) },
          { key: 'y mod N', value: String(yProd) },
          { key: 'gcd(x - y, N)', value: String(g) },
          { key: 'p', value: String(p) },
          { key: 'q = N / p', value: String(qq) },
          { key: 'trivial gcds first', value: String(trivial) },
        ],
        pivotal: true,
      });
      return {
        p,
        q: qq,
        ms: performance.now() - t0,
        trace: {
          algorithm: 'qs',
          steps,
          metrics: [
            ...qsMetrics(factorBase.length, relations.length),
            { key: 'dependencies', value: String(deps.length) },
            { key: 'trivial gcds', value: String(trivial) },
          ],
          why: {
            kind: 'relations',
            factorBaseSize: factorBase.length,
            relations: relations.length,
            dependencies: deps.length,
            trivialAttempts: trivial,
            x: String(xProd),
            y: String(yProd),
          },
          gaveUp: null,
        },
      };
    }
    trivial++;
    steps.push({
      label: `Dependency ${trivial}: trivial gcd`,
      detail:
        'This dependency gave x = +/- y (mod N), so gcd came out as 1 or N. That happens about half the time and it is not a bug -- it is why the sieve collects several spare relations and simply tries the next dependency.',
      values: [{ key: 'gcd', value: String(g) }],
    });
  }

  return gaveUp(
    'qs',
    steps,
    [...qsMetrics(factorBase.length, relations.length), { key: 'trivial gcds', value: String(trivial) }],
    `all ${deps.length} dependencies gave a trivial gcd -- collect more relations`,
    'linear algebra',
    performance.now() - t0
  );
}

/** A few rows of the GF(2) matrix, so the linear algebra is visible on screen. */
function matrixPreview(matrix: number[][]): string {
  return matrix
    .slice(0, 6)
    .map((row) => row.slice(0, 40).join(''))
    .join(' / ');
}

function qsMetrics(fbSize: number, relations: number): { key: string; value: string }[] {
  return [
    { key: 'factor base', value: String(fbSize) },
    { key: 'relations', value: String(relations) },
  ];
}
