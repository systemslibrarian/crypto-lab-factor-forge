# Contributing to Factor Forge

This lab makes arithmetic claims on screen and then proves them. Almost everything below exists to
keep that true, so please read it before opening a pull request rather than after.

## The bar

The whole point of this repository is that nothing is asserted that is not computed. A change that
makes the page *say* something correct without *computing* it has made the lab worse even if every
pixel is right.

Two style rules follow from that and are enforced by review:

- **Comments explain WHY, especially where the answer is not obvious.** Where a comment sits on a
  fixed defect, it says what the defect was and what it cost. That is the sentence that stops the
  defect coming back; a comment that only restates the code does not.
- **Plain, exact prose.** No emojis in code or in markdown. No marketing language, no hedging, no
  exclamation marks. If a limitation exists, name it.

## Prerequisites

Node **22**, matching `.nvmrc`, the `engines` range in `package.json`, and what CI installs. The
workflow reads the version from `.nvmrc` via `node-version-file`, so those three cannot drift into
three different answers.

```bash
nvm use            # reads .nvmrc
npm install
```

## Local commands

```bash
npm run dev          # Vite dev server, http://localhost:5173
npm test             # unit tests (Vitest), src/**/*.test.ts
npm run test:watch   # the same, in watch mode
npm run build        # tsc --noEmit, then vite build — the typecheck GATES the build
npm run preview      # serve dist/ at the Pages subpath
```

End-to-end, against the production build. Install the browsers once:

```bash
npx playwright install --with-deps chromium firefox webkit
```

then:

```bash
npm run test:a11y     # the WCAG gate: axe-core plus computed contrast, Chromium, desktop and 380px
npm run test:claims   # the claims suite on EVERY claims project
npm run test:e2e:all  # everything: the claims projects and the a11y gate
```

The e2e run builds the site first (`webServer.command` is `npm run build && npm run preview`),
because `vite preview` serves only whatever is already in `dist/`. Without that, a failing build
leaves the previous good bundle in place and the suite passes green against code that no longer
compiles.

### The project layout, and why `test:claims` uses a glob

`playwright.config.ts` defines five projects: `a11y` on Chromium, and `claims`, `claims-mobile`,
`claims-firefox`, `claims-webkit` all running the whole of `e2e/claims.spec.ts`. Twenty claims
executions is the claims suite times the number of browser projects, plus the a11y
scans. The exact number is not written down anywhere on purpose: it changes whenever a
claim or a project is added, and a stale count in prose is precisely the defect this lab
spent a release fixing on its own pages.

`test:claims` selects them with `--project="claims*"`, not by listing names. The script used to be
`--project=claims`, an exact match that silently excluded `claims-mobile`, so CI enforced half the
suite the README advertised and nothing in the output said so. A glob means a claims project added
to the config is picked up automatically. CI does not even rely on that: it runs `test:e2e:all`,
which takes no project filter at all, so no project can be defined and quietly escape the gate.

The a11y gate stays Chromium-only deliberately. Its oracle includes contrast ratios computed from
rendered colours and a pinned non-text-contrast baseline, both of which are rendering-engine
specific. Running it on three engines would turn one deterministic signal into three
engine-flavoured ones.

## The invariants

These are the architecture, not aspirations. A change that breaks one is not a change to this lab.
They are stated in `README.md` and repeated here because they are what review checks against.

| | |
|---|---|
| **I1** | Every reported factor is verified by `p·q = N` **and** by Miller–Rabin before it is shown. The verifier imports no algorithm module. |
| **I2** | "Why it worked" is computed, never asserted: `p−1` is factored and displayed, Fermat's `\|p−q\|` is measured, and ECM's curve order is counted over `F_p` post hoc by walking the Hasse interval. |
| **I3** | Timing is real `performance.now()`, shown with the size it was measured at, never extrapolated. |
| **I4** | The weak-`N` generator runs the targeted method **and** the methods that must fail before returning a candidate. |
| **I5** | A trivial `gcd` from a GF(2) dependency is reported as a retry, with a count, not hidden. |

I1 has a structural half that is easy to erode by accident: `src/verify/verify.ts` imports no
algorithm module, and a unit test reads that file and asserts its import list to keep it that way.
A bug in an algorithm must not also be the thing that blesses its own output. If you find yourself
wanting to import an algorithm into the verifier to make something convenient, that is the test
doing its job.

## The gates may never be weakened to make a change pass

This is the one rule with no exceptions.

The a11y gate, the claims suite and the pinned vectors are the reason anything on the page can be
believed. If your change turns one of them red, the change is wrong until proven otherwise. It is
never acceptable to:

- delete, `skip`, or `fixme` a failing test;
- loosen an assertion, widen a tolerance, or relax a bound so a value fits;
- add an entry to the non-text-contrast baseline in `e2e/nontext-baseline.ts` to silence a new
  finding — the baseline records what was already there, and `expectBaselineNotStale()` exists so
  it cannot quietly grow;
- narrow the states the a11y drive visits so a bad state is no longer scanned;
- drop a project from `playwright.config.ts` or reintroduce a project filter in CI.

If a gate is genuinely wrong — asserting something that is not true of correct behaviour — then
fix the gate as its own change, with the reasoning in the commit and a comment saying what it used
to assert and why that was wrong. That is a different act from making a red run go green.

The pinned vectors in `src/factor/vectors.ts` assert **both** halves: which methods each vector
falls to and which it resists. That is deliberate. A change that makes a method accidentally
stronger fails the suite exactly as loudly as one that makes it weaker, because both mean the lab
is now teaching something other than what it says.

## Mutation-testing discipline

Before you trust a test you have written or a gate you have touched, prove it bites. A test that
cannot fail is worse than no test, because it is counted as coverage.

The discipline, in order:

1. **Invert a condition in the SOURCE.** Not in the test, not in a fixture — in the code the test
   is supposed to be guarding. Flip a comparison, drop a `!`, return the wrong branch. Something
   the owning test must object to.
2. **Confirm the build still succeeds.** `npm run build`. If the typecheck rejects the mutation,
   the mutation was not a behavioural change and proves nothing about the test; pick another one.
3. **Confirm the bundle hash changes.** Compare the emitted filenames under `dist/assets/` before
   and after. If the hash is unchanged, the mutated code never reached the bundle — it was dead
   code, tree-shaken away, or you edited a file the entry graph does not include — and the e2e run
   would have been testing the old behaviour regardless of the test's quality.
4. **Confirm the owning test fails**, and that it is the *right* test that fails, with a message
   that names the actual problem. A test failing for an unrelated reason is not evidence.
5. **Restore.** `git diff` must be empty of the mutation before you commit. Never commit a
   mutation, not even behind a flag.

Steps 2 and 3 are the ones people skip, and they are the ones that catch the two failure modes
that matter: a "test" that only ever exercised code the build rejects anyway, and a gate scanning
a bundle that does not contain the code under test.

## Pull requests

- CI runs on `pull_request`, so the gate judges your branch before it judges `main`. Wait for it.
- On failure the Playwright HTML report is uploaded as a build artifact — the reporter emits it in
  CI as well as locally, so there is something real to download.
- Keep the README honest. If you change what the suite covers, what a method's default budget is,
  or what a measured figure is, the README's numbers change in the same commit.
- Dependabot bumps auto-merge only once this lab's own gate passes on the PR. The gate decides,
  not the version number.

## Reporting rather than fixing

If you have found a wrong factorization, a false primality verdict or a false claim on screen and
do not want to fix it yourself, that is a valuable report on its own. `SECURITY.md` says what to
include and where to send it.
