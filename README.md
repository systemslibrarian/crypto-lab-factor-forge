# Factor Forge

Classical integer factorization in the browser — trial division, Fermat, Pollard rho (Brent),
Pollard p−1, Williams p+1, Lenstra ECM and the quadratic sieve, run against a real BigInt `N`,
each one keyed to the structural weakness it exploits.

**Live demo:** https://systemslibrarian.github.io/crypto-lab-factor-forge/

---

## What It Is

There is no single "factoring algorithm". There is a family of them, and each one is waiting for a
different mistake:

| Method | Exploits | Cost tracks |
|---|---|---|
| Trial division | a factor small enough to divide by | the smallest factor |
| Fermat difference of squares | `p` and `q` close together | `\|p − q\|` |
| Pollard rho (Brent) | a birthday collision mod the unknown `p` | the smallest factor |
| Pollard p−1 | `p − 1` being B-smooth | the smoothness of `p − 1` |
| Williams p+1 | `p + 1` being B-smooth | the smoothness of `p + 1` |
| Lenstra ECM | *some* elliptic curve over `F_p` having smooth order | the smallest factor |
| Quadratic sieve | **nothing** about `p` or `q` — only `x² ≡ y² (mod N)` | the size of `N` |

Every method here is a real implementation over native `BigInt`. Nothing is simulated, nothing is
approximated, and no result is displayed until an independent verifier has multiplied the claimed
factors back to `N` and put each through Miller–Rabin.

The point the lab exists to make: RSA key generation is not a list of arbitrary requirements. Each
rule closes exactly one of these doors. And **none of them does anything against Shor**, because
Shor exploits no structure of `N` at all — which is why "use safe primes" and "use bigger primes"
are answers to the classical list and not to the quantum one.

**Security model:** none. This is a teaching demo. It factors numbers small enough to finish in a
browser tab while you watch, which is many orders of magnitude below an RSA modulus. **Not
production cryptography.**

### What it does NOT prove

- It does not show that RSA is breakable. Every size here is a teaching size; the largest `N` the
  page will accept is 40 digits (~133 bits) against RSA's 2048.
- The number field sieve is a **pointer, not an implementation**. Every NFS figure on the page is
  the standard `L_N[1/3, 1.923]` cost formula, labelled as a formula.
- There is no quantum simulation. The Shor row is a cost comparison and a link to
  [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/), not a computation.
- Miller–Rabin is probabilistic. Below 3.317 × 10²⁴ the base set used here is proven deterministic
  (Sorenson & Webster, *Math. Comp.* 2015) and the page says so; above it the page says the verdict
  rests on random bases.
- Timings are real `performance.now()` measurements of your browser on your machine. They are
  never extrapolated upward to a larger size.

### The negative claim

> Obeying every key-generation rule this page teaches does not make `N` hard to factor — it only
> removes the methods that need a structure.

That sentence is not a disclaimer; it is a fixture. **Weak N Forge → "No structure at all"** builds
a modulus that satisfies all four rules, proves it by watching trial division, Fermat, p−1 and p+1
each give up, and then factors the same modulus with Pollard rho and ECM in milliseconds. Every
check on screen reports success and the modulus falls anyway. `e2e/claims.spec.ts` asserts all three
halves of that: the fixture is reachable, every rendered verdict in it reports success, and the
limitation is visible in that state.

---

## Exhibits

1. **Factor N** — paste or pick an `N`, see its shape (prime, even, perfect power, or a fair
   target), and run any method or race all seven. Each row reports whether it won, how long it took,
   and *why* — the structural property it found, computed from the recovered factor. A row that
   gives up says what it gave up on, because that is a result about `N`, not a bug.
2. **Parameters** — the bound `B` for p−1 and p+1, ECM's `B1`/`B2`/curve budget, the sieve's factor
   base and interval, and every step cap. These are the whole content of the methods they belong to;
   moving `B` and watching which primes it catches is the exercise. Changing any of them retires the
   board, because a verdict earned under a different bound is not a verdict about this one.
3. **More than two factors** — every method returns *one* split. Recurse it and watch the tree,
   with the method that produced each split named.
4. **Weak N Forge** — pick a weakness (small factor · close primes · smooth p−1 · smooth p+1 ·
   none) and get an `N` that has it. Nothing is returned until the targeted method has actually
   factored it and the others have actually failed.
5. **Trace** — step through a run. The `x_i` sequence and the gcd that pops for rho; the `a`-walk
   for Fermat; the curve counter, sigma, and the non-invertible denominator for ECM; the factor
   base, the smooth relations, the GF(2) matrix and the dependency for the sieve.
6. **The Ladder** — seven charts with seven different x-axes, each labelled with what that method
   actually depends on. Your own measured runs are plotted on the same axes. Only the three methods
   that genuinely depend on `N` share an against-`N` chart, alongside Shor.
7. **Shor & the RSA Rules** — which rule defends against which method, and the row where every
   answer is "No".

---

## When to Use It

- **Do** use it to understand why RSA key generation says what it says, and why "just use a bigger
  key" is a real answer to the sieve and not to Shor.
- **Do** use it to see that ECM's cost tracks the *smallest factor* and not the size of `N` — the
  single most useful fact about factoring in practice.
- **Do NOT** use any of this code for cryptographic work. It is written to be read, not to be fast
  or constant-time, and the primality test is probabilistic by design.
- **Do NOT** read a timing here as evidence about a real key. Nothing on this page is extrapolated.

---

## What Can Go Wrong

- **A small prime survives key generation.** Trial division ends it. Under the default bound of
  100,000 this page finds any factor up to about 17 bits instantly.
- **`q` chosen as the next prime after `p`.** Fermat needs about `(p − q)² / (8·√N)` steps, so a
  gap of ten is a couple of steps. The pinned close-primes vector is a 96-bit `N` that falls in
  under a millisecond.
- **`p − 1` built from small primes.** Pollard p−1 walks straight in. Safe primes exist to stop
  exactly this.
- **A safe prime is not enough.** `p = 2q + 1` fixes `p − 1` and leaves `p + 1 = 2(q + 1)`
  arbitrary. The forge's "smooth p+1" target builds a modulus where p−1 fails and p+1 wins.
- **Every rule obeyed.** rho and ECM still factor it at these sizes. Only size defeats them.
- **A trivial `gcd` from the sieve.** About half of all GF(2) dependencies give `x ≡ ±y (mod N)` and
  a useless gcd. The page reports that as a retry and moves to the next dependency rather than
  hiding it.

---

## Real-World Usage

- **ECM** is the working tool for finding medium-sized factors of large numbers, and the reason
  the ECMNET/GMP-ECM record for a found factor sits in the 80-digit range even though the numbers
  it was found in were far larger.
- **Pollard p−1** is why FIPS 186-4 and the older ANSI X9.31 required "strong" primes with a large
  prime factor in `p − 1`; modern guidance largely dropped the requirement because ECM made the
  distinction irrelevant at real key sizes.
- **Fermat** is why "generate `q` near `p`" is a documented implementation bug rather than an
  optimisation — it has broken real keys, including a 2022 batch of hardware-generated RSA keys.
- **The quadratic sieve** factored RSA-129 in 1994; the **number field sieve** has held the records
  since, and its `L_N[1/3, 1.923]` cost is what current RSA key-size recommendations are derived
  from.

---

## Performance — measured, not projected

Measured in Chromium on the machine this lab was built on, against the production build served at
the deployed subpath. Your numbers will differ; the page shows its own.

| Method | Default budget | What it reached here |
|---|---|---|
| Trial division | primes ≤ 100,000 | factors up to ~17 bits, < 1 ms |
| Fermat | 200,000 `a`-steps | any gap with `(p−q)²/(8√N) < 200,000`; a 10⁸ gap on an 80-bit `N` in 0.4 ms |
| Pollard rho | 3,000,000 iterations | 44-bit factors in ~120 ms; fails at 48 bits |
| Pollard p−1 | `B1` = 10,000, stage 2 to 400,000 | largest prime of `p−1` up to ~17,000, in ~7 ms |
| Williams p+1 | `B1` = 10,000, 8 bases | largest prime of `p+1` up to ~6,000, in ~6 ms |
| Lenstra ECM | `B1` = 20,000, `B2` = 400,000, 60 curves | 48-bit factors in ~130 ms, largely independent of `N` |
| Quadratic sieve | base bound 6,000, interval ±150,000 | `N` up to ~60 bits in ~70 ms; at 63 bits it reports too few relations and says so |

The page's input ceiling is 40 digits. That number is not a property of the mathematics — it is
where a browser tab stops finishing while you watch.

---

## How to Run Locally

```bash
npm install
npm run dev        # http://localhost:5173
```

---

## Build & Verify

```bash
npm test           # 113 unit tests (Vitest)
npm run build      # tsc --noEmit, then vite build
npm run test:claims  # 20 claims tests, desktop and mobile viewports
npm run test:a11y  # axe-core WCAG 2.1 A/AA gate, desktop and 380px
```

- **Unit tests** cover the BigInt core against naive reference implementations (Jacobi against a
  brute-force residue count, `primesBelow` against trial division, `modpow` against repeated
  multiplication), Miller–Rabin against a sieve for every `n < 5000` plus the Carmichael numbers and
  a strong pseudoprime to bases 2/3/5/7, and every algorithm against pinned vectors.
- **Pinned vectors** (`src/factor/vectors.ts`) fix the sizes at build time and record which methods
  each one falls to and resists. Both halves are asserted, so a change that makes a method
  accidentally stronger or weaker fails the suite.
- **Claims** (`e2e/claims.spec.ts`) check the *page*, not the source: `p × q` is recomputed from the
  rendered verdict, Fermat's step count is re-derived independently as `(p+q)/2 − ⌈√N⌉`, the
  smoothness of `p − 1` is re-factored in the test, the ECM curve order is checked against Hasse's
  bound and against its own printed factorization, and the sieve's `x` and `y` are checked to
  satisfy `x² ≡ y² (mod N)` with `x ≢ ±y`.
- **The verifier is isolated.** `src/verify/verify.ts` imports no algorithm module, and a test reads
  the file and asserts its import list to keep it that way — a bug in an algorithm must not also be
  the thing that blesses its own output.
- **The a11y gate** drives the real controls through every state the lab renders — including both
  input failure branches, the parameters disclosure out of range, the negative-claim fixture and
  three hover states — and scans each one, at desktop and phone width.

### Invariants the architecture embodies

| | |
|---|---|
| **I1** | Every reported factor is verified by `p·q = N` and by Miller–Rabin before it is shown. The verifier imports no algorithm module. |
| **I2** | "Why it worked" is computed, never asserted: `p−1` is factored and displayed, Fermat's `\|p−q\|` is measured, and ECM's curve order is counted over `F_p` post hoc by walking the Hasse interval. |
| **I3** | Timing is real `performance.now()`, shown with the size it was measured at, never extrapolated. |
| **I4** | The weak-`N` generator runs the targeted method and the methods that must fail before returning a candidate. |
| **I5** | A trivial `gcd` from a GF(2) dependency is reported as a retry, with a count, not hidden. |

---

## References

- Pollard, "Theorems on factorization and primality testing", *Proc. Cambridge Philos. Soc.* **76**
  (1974) 521–528. — p−1
- Pollard, "A Monte Carlo method for factorization", *BIT* **15** (1975) 331–334. — rho
- Brent, "An improved Monte Carlo factorization algorithm", *BIT* **20** (1980) 176–184.
- Williams, "A p+1 method of factoring", *Math. Comp.* **39** (1982) 225–234.
- Pomerance, "The quadratic sieve factoring algorithm", *EUROCRYPT 84*, LNCS 209, 169–182.
- H. W. Lenstra Jr., "Factoring integers with elliptic curves", *Annals of Mathematics* **126**
  (1987) 649–673.
- Montgomery, "Speeding the Pollard and elliptic curve methods of factorization", *Math. Comp.*
  **48** (1987) 243–264.
- Lenstra, Lenstra, Manasse & Pollard, "The number field sieve", in *The Development of the Number
  Field Sieve*, LNM 1554 (1993). — **pointer only; not implemented here**
- Sorenson & Webster, "Strong pseudoprimes to twelve prime bases", *Math. Comp.* **84** (2015). —
  the deterministic Miller–Rabin base set

---

## Related Demos

- [crypto-lab-shor](https://systemslibrarian.github.io/crypto-lab-shor/) — the period-finding half
  of this story, and the row on the ladder that no rule here defends against.
- [crypto-lab-rsa-educational](https://systemslibrarian.github.io/crypto-lab-rsa-educational/) —
  builds the keys these rules are about, and breaks a deliberately tiny one with trial division and
  rho.
- [crypto-lab-rsa-forge](https://systemslibrarian.github.io/crypto-lab-rsa-forge/) — attacks the
  padding and the protocol rather than the modulus.
- [crypto-lab-time-lock-puzzle](https://systemslibrarian.github.io/crypto-lab-time-lock-puzzle/) —
  what an RSA modulus is worth when you *want* the work to be hard.
- [crypto-lab-vdf](https://systemslibrarian.github.io/crypto-lab-vdf/) — sequential work in a group
  of unknown order, which is the same modulus seen from the other side.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
