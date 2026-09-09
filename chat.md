# Factor Forge: What Would Make It a 10/10 Gold Standard

**Review date:** 2026-09-08  
**Scope:** product experience, mathematical honesty, runtime behavior, accessibility, testing, reproducibility, delivery, and public-project readiness.

## Executive verdict

Factor Forge is already unusually strong. It implements seven real factoring methods over `BigInt`, independently verifies every claimed factorization, exposes failed searches instead of disguising them, runs long work in a worker, and backs its teaching claims with an exceptional browser test suite. This is much closer to a reference-quality educational lab than a typical demo.

**Working score: 8.6/10.** The remaining gap is not “add more algorithms” or “make it prettier.” The gap is:

1. fix three runtime trust failures around cancellation, stale work, and hidden errors;
2. remove several small but important scientific/content contradictions;
3. make experiments reproducible and benchmark claims statistically honest;
4. shorten the mobile path from arrival to the first useful action;
5. expand from excellent automated Chromium accessibility to cross-browser and manual assistive-technology confidence.

A true 10/10 release should make every visible result attributable to the exact input, parameters, seed, and app version that produced it. It should also be impossible for cancelled or obsolete work to reappear as current evidence.

## Evidence gathered

- `npm test`: **112/112 unit tests passed** across BigInt helpers, primality, all algorithms, the weak-number generator, recursive factorization, and the isolated verifier.
- `npm run build`: TypeScript and Vite production build passed.
- `npm run test:e2e:all`: **42/42 Playwright executions passed**, including desktop/mobile claim checks and the full WCAG 2.1 A/AA state drive.
- Production output is small: about **27.94 kB gzip** for application JavaScript, **2.52 kB gzip** for CSS, plus a **36.20 kB** worker chunk.
- `npm audit`: no runtime dependency exposure, but **two moderate development advisories** through `vitest` / `@vitest/mocker` (`GHSA-82fw-gwwq-j7x9`). The available fix currently requires Vitest 5.
- Live desktop and 380 px browser reviews were performed against the production build.
- The worktree was clean before this report was added.

## Current scorecard

| Area | Current | Why it is not yet 10 |
|---|---:|---|
| Mathematical implementation | 9.4 | Real algorithms and strong vectors; needs a final expert wording/formula audit and stronger independent differential/property testing. |
| Truthfulness of results | 8.0 | Independent verification is excellent, but stale jobs can be attached to a new `N`, which violates the product's central trust promise. |
| Teaching design | 8.7 | Strong “why” evidence and negative claims; the Trace is still mostly textual and newcomer jargon arrives quickly. |
| First-use UX | 7.8 | Clear desktop flow, but mobile requires roughly two screens of reading before the primary action. |
| Accessibility | 9.6 | Exceptional automated gate; still Chromium-only and not documented against a manual VoiceOver/keyboard/zoom matrix or WCAG 2.2. |
| Test engineering | 9.0 | Excellent claim-level E2E tests; missing lifecycle, cancellation, worker-failure, cross-browser, visual-regression, and coverage gates. |
| Reproducibility | 6.8 | Randomized runs have no visible seed, permalink, export, repeat distribution, or environment record. |
| Performance architecture | 8.8 | Small bundle and worker isolation; fallback can freeze the main thread and is invisible to the user. |
| Delivery and supply chain | 8.5 | Strong gated Pages workflow and Dependabot automation; known dev advisories, floating Action tags, and no explicit least-privilege hardening evidence. |
| Documentation/discovery | 8.8 | README is unusually candid and detailed; metadata count, citation links, social preview, and contributor/security docs need finishing. |

## P0: Fix runtime trust first

### 1. Make cancellation cancel the whole batch

**Confirmed behavior:** pressing **Cancel** during “Race all seven” terminated the active worker, but the sequential loop then launched later algorithms. Six rows still produced results after cancellation.

The cause is local: `raceAll()` in `src/ui/race.ts` continues its `for` loop after `Runner.cancel()` rejects the current `runOne()`. There is no batch token or cancelled state to stop the next iteration.

**Gold-standard fix:**

- Give every batch a monotonically increasing `runId` or `AbortSignal`.
- Have `Cancel` invalidate the batch before terminating the worker.
- Check the token before and after every awaited run and break immediately when invalidated.
- Render an explicit `CANCELLED` state; do not silently return a row to idle.
- Rename the action to **Run all sequentially** or disclose beside it that methods run one at a time for comparable timing. “Race” currently implies concurrency even though the sequential design is intentional.

**Acceptance test:** start a slow batch, cancel it, and assert that the active row becomes cancelled, no later row enters busy state, no later result appears after a delay, and the button returns to a ready state.

### 2. Bind every outcome to an immutable experiment

**Confirmed behavior:** rho was started on the default 96-bit modulus; while it ran, `N` was changed to `15`. The old result later appeared on the board for `15` with the old “3,000,000 iterations” explanation.

`runOne()` starts with the current state, while `recordRun()` verifies and stores against whatever `state.n` happens to be when the promise resolves. Parameter edits have the same class of risk.

**Gold-standard fix:**

- Snapshot `{ runId, n, params, capMs, algorithm }` before dispatch. Deep-copy parameters.
- Return that context with the worker response.
- Store a result only when its context still matches the active experiment.
- On `N` or parameter change, cancel current work or mark it superseded and discard its completion.
- Put the experiment identity in the run record so traces and charts cannot read mutable global state as provenance.

**Acceptance tests:** change `N`, a bound, and the selected preset during a slow run; in every case, assert that the obsolete completion is discarded and never appears in the board, Trace, or Ladder.

### 3. Never swallow an execution error

`runOne()` currently has an empty `catch` apart from clearing `state.running`. If both the worker and inline fallback fail, the user sees a row quietly return to idle or retain an older result.

**Gold-standard fix:** add a distinct `error` outcome carrying a safe message and recovery action. Test worker construction failure, worker runtime failure, malformed protocol response, inline fallback failure, and cancellation separately. If module workers are unavailable, show a persistent compatibility notice that work is now main-thread and cannot be honestly cancelled.

## P0: Complete the content-integrity pass

Small contradictions matter more here than in an ordinary site because the product explicitly sells precision.

- `index.html` says **“Six classical integer factoring algorithms”** and then lists seven. Correct the count and add an automated metadata assertion.
- `src/ui/ladder.ts` says **“These four”** against-`N` methods, while the chart and its accessible description contain three series: QS, NFS, and Shor.
- The Ladder intro/comment/README variously say “only three methods,” “three plus Shor,” and “these four.” Replace count-based prose with one exact inventory and test it.
- `safePrime()`'s comment in `src/factor/primality.ts` says `p + 1` has a huge prime factor, while the lab correctly teaches elsewhere that a safe prime does **not** guarantee that. Fix the comment so maintainers are not taught the opposite of the UI.
- Clarify **“Shor exploits no structure of N at all.”** More exact wording is: Shor needs no accidental weakness in how `p` and `q` were chosen; it uses the universal periodic structure of modular exponentiation. This preserves the lesson without making an over-broad mathematical statement.
- Clarify the apparent tension between “larger moduli do nothing against Shor” and the later statement that size raises its qubit/gate requirements. A two-column distinction between **changes resources** and **changes asymptotic class** would be exact.
- Link in-app citations to primary papers, standards, and stable identifiers. Have a cryptography subject-matter reviewer sign off on the RSA guidance/history claims, especially strong/safe-prime requirements and the interpretation of modern guidance.

## P1: Make the experiment scientifically reproducible

### 4. Add experiment identity, sharing, and export

Every result should carry:

- `N`, all bounds, wall-clock cap, algorithm, app version/commit, browser, and platform;
- the random seed or random transcript for probabilistic algorithms and generated examples;
- start/end time, operation counters, wall time, verdict, and verifier details.

Add **Copy permalink** and **Export run JSON**. Encode stable inputs and the selected exhibit in the URL. Keep cryptographic randomness in production, but make the RNG injectable so tests and explicitly seeded teaching runs are repeatable. Do not put sensitive data in the URL; this lab currently handles only public teaching inputs.

### 5. Separate demonstration timing from benchmarking

A single wall-clock sample is real, but it is not a robust comparison. Sequential order introduces warm-up/order effects, and randomized methods have run-to-run variance.

For benchmark mode:

- warm up, run a user-selectable sample count, and report median plus range/IQR;
- preserve per-run seeds/transcripts;
- show algorithmic work units as the primary comparison and milliseconds as machine-specific context;
- record browser/hardware context and explicitly label sequential execution;
- never mix measurements produced under different parameters or app versions.

The existing one-click run can remain the fast teaching path.

## P1: Improve the learning experience

### 6. Put the first useful action above the mobile fold

At 380 × 844, the initial document measured **3,756 px** tall. The primary “Race all seven” button began around **1,683 px**, and the board around **1,888 px**. A learner passes the hero, tabs, a 439 px intro, and most of a 605 px input card before doing anything.

Keep the honesty, but remove repetition:

- collapse the panel intro into a two-sentence setup or a “Why this works” disclosure;
- place the preset, `N`, and primary action immediately after the hero/tabs;
- use a compact “Try this first: close primes” guided prompt;
- reveal the deeper explanation after the first result, when the learner has context;
- keep all expert parameter controls in the existing disclosure.

**Acceptance target:** on a 380 × 844 viewport, the selected example and primary action are both reachable within the first viewport or with only a small, obvious scroll; no content is removed from keyboard or screen-reader access.

### 7. Turn Trace from a log into a mechanism view

The trace is accurate, but its main representation is a stack of text/value blocks. A gold-standard teaching tool should visually expose the mechanism:

- rho: animate the tortoise/hare sequence and highlight the gcd collision;
- Fermat: show `a² - N` approaching a square;
- p−1/p+1: show exponent accumulation and where the smooth bound succeeds/fails;
- ECM: show successive curve attempts and the non-invertible denominator that reveals a factor;
- QS: show relation collection, parity vectors, row reduction, dependency, then the non-trivial gcd.

Keep the existing text and tables as the accessible equivalent. Add a direct **Open trace** action to each completed row and preserve the exact step on back navigation.

### 8. Add progressive jargon support

Terms such as B-smooth, curve order, Hasse interval, factor base, GF(2), and dependency appear quickly. Add concise inline definitions or a glossary disclosure, consistently linked from first use. Avoid tooltips as the only source because they are poor on touch and can be awkward for assistive technology.

## P1: Expand verification beyond the current strengths

### 9. Test lifecycle behavior as aggressively as mathematical claims

Add focused tests around `Runner`, state, and UI orchestration:

- cancel one run and cancel a batch;
- edit `N`/parameters while running;
- start multiple individual rows;
- worker startup/runtime/protocol failures;
- inline fallback behavior and its warning;
- repeated clicks, tab changes, and late progress events;
- result provenance through Board → Trace → Ladder.

Use a fake worker/transport for deterministic unit tests and retain one real-worker production E2E path.

### 10. Add browser, visual, and coverage gates

- Run a compact claim/smoke suite in **Chromium, Firefox, and WebKit**. Keep the exhaustive accessibility drive in Chromium if CI time matters.
- Add targeted visual snapshots for arrival, completed race, expanded parameters, full trace, Ladder, and the negative-claim fixture at desktop and mobile widths.
- Add coverage reporting with thresholds focused on branch-heavy correctness and lifecycle modules; do not chase line coverage in static rendering code for its own sake.
- Add property/differential tests against an independent trusted oracle for a bounded corpus, and mutation-test the verifier plus job-lifecycle state machine.
- Add explicit tests for metadata/count consistency so “six/seven” and “three/four” cannot regress.

### 11. Finish accessibility with human evidence

The automated gate is already a model worth preserving. To reach the final tier, document manual checks for:

- VoiceOver + Safari on macOS/iOS;
- keyboard-only operation and focus order in all exhibits;
- 200% and 400% zoom/reflow;
- reduced motion, forced colors/high contrast, and text spacing overrides;
- announcements for progress, cancellation, errors, retired results, and completed batches;
- WCAG **2.2 AA**, including target size and focus appearance.

Do not weaken the current `violations` + `incomplete` + contrast + non-text gate.

## P2: Release and public-project hardening

### 12. Close the tooling and supply-chain gaps

- Validate and adopt Vitest 5 when feasible, or document a time-bounded exception for `GHSA-82fw-gwwq-j7x9` because the affected package is development-only.
- Pin GitHub Actions to reviewed commit SHAs and let Dependabot update those pins.
- Move Pages write/id-token permissions to the deploy job where practical; keep build/PR jobs read-only by default.
- Add explicit Node engine/version policy matching CI, a formatting/lint command, CI timeouts, and retained test reports on failure.
- Add `SECURITY.md` and `CONTRIBUTING.md`; describe that this is educational, has no production-crypto support promise, and explain how to report mathematical or security defects.
- Consider an SBOM/provenance artifact for releases. This is low effort because the shipped app has no runtime package dependencies.

### 13. Finish public metadata and discoverability

- Add a canonical URL, `og:image`, image dimensions/alt, and an appropriate Twitter card.
- Create a real social preview showing the race board, not an atmospheric graphic.
- Add educational-software structured data if the wider Crypto Lab catalog uses it.
- Link the deployed build to a visible version/commit so exported experiments can be audited later.

## Recommended implementation order

1. **Runtime integrity:** batch cancellation, immutable experiment contexts, stale-result rejection, visible errors, and regression tests.
2. **Content integrity:** count mismatches, safe-prime comment, Shor wording, exact chart inventory, and primary-source links.
3. **Mobile first action:** remove repeated setup copy and move the experiment controls upward.
4. **Reproducibility:** seeded/injectable randomness, permalink, JSON export, and provenance-bearing run records.
5. **Benchmark mode and richer traces:** distributions instead of single timing claims; visual mechanism views with accessible equivalents.
6. **Release hardening:** cross-browser smoke tests, manual accessibility matrix, visual regression, coverage/property tests, audit resolution, and workflow pinning.

## 10/10 acceptance checklist

- [ ] Cancel guarantees that no current or queued work can later publish a result.
- [ ] Changing `N`, parameters, or app version invalidates every incompatible in-flight result.
- [ ] Every error, fallback, cancellation, and superseded run has an explicit user-visible state.
- [ ] Every displayed result has immutable provenance: input, parameters, seed/transcript, environment, and build version.
- [ ] All counts and chart inventories agree across metadata, UI, README, tests, and accessible descriptions.
- [ ] A subject-matter reviewer approves the Shor, safe-prime, RSA-guidance, and asymptotic-model wording.
- [ ] The primary mobile action is near the first fold, while all caveats remain available through progressive disclosure.
- [ ] Benchmark views report distributions and work units, not a lone timing presented as representative.
- [ ] Core flows pass in Chromium, Firefox, and WebKit; the documented manual accessibility matrix is green.
- [ ] Unit, build, claims, accessibility, lifecycle, and visual gates all pass in CI with no unexplained audit exception.
- [ ] A shared URL or exported JSON can reproduce the same experiment and explain any unavoidable timing variance.

## What not to add

- Do not add more factoring algorithms until the execution lifecycle is trustworthy.
- Do not add decorative animation; use motion only to reveal a mathematical mechanism.
- Do not add a backend, accounts, or cloud persistence for a local educational lab.
- Do not add a light theme merely to claim feature breadth; the repository's fleet standard intentionally fixes the dark theme.
- Do not weaken the existing verifier, claims suite, or accessibility gate to make new work easier.

The shortest path to 10/10 is therefore not broader scope. It is making the existing scope impossible to misattribute, easy to reproduce, faster to enter on mobile, and even more exact in its scientific language.