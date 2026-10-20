# Extension brief — `crypto-lab-factor-forge`

**2026-10-20. Extension to a live lab; no new repository.** Written against
`crypto-lab-factor-forge` at `8fd7436210e0` and `audits/_MASTER-TEMPLATE.md` (catalog
`f48d9d2f2f06`). Template §5: "Extend, never restructure." Source of the gap: Katz–Lindell,
*Introduction to Modern Cryptography*, 3rd ed. (CRC Press, 2021), §12.5.6, the closing
paragraph "Randomness quality in RSA key generation".

**Verdict: extension — one new tab, "Shared Primes", inside the existing lab.**

## What the lab has now (read at `8fd7436210e0`)

- Five tabs (`index.html:202–217`): Factor N, Weak N Forge, Trace, The Ladder, Shor & the RSA
  Rules. Panels mount lazily through `MOUNTERS` in `src/main.ts:29–35`.
- Seven single-`N` methods behind one interface, `factor(N, params, budget) -> FactorOutcome`
  (`src/factor/types.ts:161`), wired in `REGISTRY` (`src/factor/registry.ts:16`).
- The verifier `verifyFactorization` (`src/verify/verify.ts:50`) imports no algorithm module,
  and `src/verify/verify.test.ts:52` asserts that import list (invariant I1).
- A seeded, replayable RNG: `seededRng`, `withSeed` (`src/factor/rng.ts:56, 110`), xoshiro256**
  over SplitMix64, documented there as "NOT a cryptographic generator … only consumers are
  search heuristics and teaching-key generation". `randomPrime(bits)` (`src/factor/primality.ts:101`)
  draws through it.
- Worker protocol (`src/worker/protocol.ts`): `factor`, `generate`, `tree` requests; BigInts
  cross as decimal strings.
- Invariants I1–I8 in `README.md:252–265` (verification, computed "why", real timing never
  extrapolated, cancellation, attribution).
- The Shor panel's rule table (`src/ui/shor.ts`) already has this row at :77–81:
  `rule: 'Use a fresh modulus per key; never share p between moduli'`,
  `defends: 'Batch GCD across a corpus of keys'`, `because: '… not a method on this page …'`.
- Tests: Vitest beside each module; `e2e/claims.spec.ts` (37 tests); `e2e/gate.ts` asserts
  `.tab-btn` count 5 at :280; `e2e/claims.spec.ts:635` asserts "None of the six rules".

Searched `src/`, `index.html`, `README.md` at this commit for `batch gcd`, `product tree`,
`remainder tree`, `shared prime`, `corpus`: the only hit is the Shor-panel row above. Batch GCD
is named, not run.

## What to add

**Tab 6 — Shared Primes.** The one method on the page that needs *many* keys rather than one
`N`, and the one weakness no single modulus can show.

1. **Make a corpus the way the book describes it.** K-L's model: each key draws `r_p` and `r_q`
   uniformly from a set `S` of size `2^s` that is far too small, and turns each into a prime.
   Here `prime(r) = withSeed(seedHex(r), () => randomPrime(bits))`. Controls: key count `K`
   (default 64), entropy `s` bits (default 10), prime size (256-bit primes default, 512 and 1024
   as "real-size" options, generated in the worker with progress and Cancel). Only `≤ 2^s`
   distinct primes can ever be produced, so generation cost is bounded by the distinct seeds
   drawn. Reject `r_p = r_q` within one key (that would make `N = p²`).
2. **Predict, then measure.** Before running anything, show the birthday prediction: `2K`
   prime draws from `2^s` seeds give about `C(2K, 2) / 2^s` colliding draw pairs (K-L: "after
   generating roughly `2^{s/2}` public keys … we expect … two different moduli … that share a
   prime factor"). Label it a prediction; the run then shows the observed count beside it.
3. **Batch GCD — the headline mechanism, shown as a tree.** Product tree up to
   `P = ∏ N_i`; remainder tree down computing `P mod N_i²`; per key
   `g_i = gcd(N_i, (P mod N_i²) / N_i)` — the gcd of each modulus with the product of all the
   others (the formulation Heninger et al. use, credited there to Bernstein). Draw both trees
   level by level with node bit-lengths, so the reader sees the root grow and the remainders
   shrink back down. Each `1 < g_i < N_i` is a recovered prime.
4. **Naive versus batch.** Run all `K(K−1)/2` pairwise gcds as well, and plot both measured
   times at the corpus sizes actually run (I3 — never extrapolated). Beside it, the publication's
   own figure, labelled as theirs: 11,170,883 distinct RSA moduli, 5.5 hours on one core
   (Heninger et al. 2012).
5. **Per-key audit, then the fall.** For a chosen victim key, run the existing single-`N`
   methods on it — trial division, Fermat, p−1, p+1 with default params and a short cap — and
   show each one give up. Then show batch GCD splitting it.

**Break-it-yourself:** drag `s` up and watch the predicted and observed shared-prime counts
fall to zero; drag it down and watch the corpus come apart.

## How it fits the lab's model

The README's thesis is "each method is waiting for a different mistake in key generation".
Batch GCD is waiting for one too — reused randomness — but it is the only one whose mistake is
invisible in any single `N`. So it gets its own tab and its own module rather than a
`REGISTRY` entry: `REGISTRY`'s "same `factor(N, params, budget)` shape" is what the race board,
worker and tests rely on, and a corpus method does not have that shape. The weak-`N` generator
(`src/gen/weak.ts`) is likewise untouched: "shared prime" is a property of a set.

**Naming collision to avoid:** "batch" already means *race all seven* in this codebase
(`startBatch`, `batchIsCurrent` in `src/ui/race.ts`, and claims tests at :368 and :830). Use
`corpus` in identifiers (`src/corpus/`, `data-panel="corpus"`, worker kind `'corpus'`) and keep
"batch GCD" for prose only.

## SECURITY / CORRECTNESS INVARIANTS

1. **I1 extends to the corpus.** Every recovered prime is passed with its modulus to
   `verifyFactorization` before it renders. `src/corpus/` must not be imported by
   `src/verify/verify.ts`; the existing import-isolation test stays green unchanged.
2. **I2:** "why it worked" is computed: the page names the other key(s) sharing the prime by
   index, found by checking `g_i` against every other modulus, not asserted from the generator.
3. **I3:** naive-vs-batch timings are `performance.now()` at the sizes run; the 2012 figure is
   quoted, labelled and cited, never fitted to.
4. **I6/I7:** a corpus run is an experiment with a context (`K`, `s`, prime bits, seed, build);
   changing any of them cancels the run in flight and retires its verdicts; Export run and
   Copy permalink include the corpus context.
5. The seed space, not the generator, is the failure. The page says the prime generator here is
   the lab's non-cryptographic xoshiro256** (as `rng.ts` already documents) and that a CSPRNG
   seeded from the same `2^s` states would fail identically.
6. The corpus is generated in the browser from public parameters; no key material is persisted.

## ARCHITECTURE

- `src/corpus/generate.ts` — `generateCorpus({K, s, bits, seed})` returning moduli plus the
  hidden `(r_p, r_q)` per key (kept for the claims suite and the "who shares with whom"
  computation; never shown before the attack runs).
- `src/corpus/batchgcd.ts` — `productTree`, `remainderTree` (mod `N_i²`), `batchGcd`, and
  `pairwiseGcd` for the naive comparison. Pure functions over `bigint[]`.
- `src/corpus/birthday.ts` — the prediction `C(2K,2)/2^s` and the exact probability of at least
  one collision, for the "predict" step.
- Worker: add `{ kind: 'corpus'; jobId; K; s; bits; seed }` to `WorkerRequest` in
  `src/worker/protocol.ts`, moduli crossing as decimal strings like every other BigInt.
- `src/ui/corpus.ts` — `mountCorpusPanel(root, runner)`, registered in `MOUNTERS`.
- `// [extension] point` in `batchgcd.ts` for a scaled remainder tree (Bernstein's speedups) and
  in `generate.ts` for the boot-time entropy model (`p` from low entropy, `q` after more
  entropy arrives), which is closer to what Heninger et al. found in devices than the book's
  symmetric model.

## UI

Controls: `K`, `s`, prime bits, seed (with the existing provenance pattern), Generate, Run batch
GCD, Run naive, Cancel. Panels: the prediction; the two trees; a table of keys with columns
*shares a prime with* (computed) and *verified* (from the verifier); the per-key audit for the
selected victim; the naive-vs-batch chart. Stacks below 640 px; trees scroll horizontally in a
labelled, focusable region.

## VISUAL SEMANTICS

A key whose prime was recovered is **ALARM** (compromised) — not green. Keys with `g_i = 1` are
neutral "shares nothing in this corpus", explicitly not "secure". The per-key audit's "gave up"
rows are rendered as the lab already renders a give-up (a result about `N`, not a bug).

## EDGE CASES

- `g_i = N_i` — both primes shared (an identical modulus, or each prime shared with a different
  key). Batch GCD alone cannot split it. Fall back to pairwise gcds against each other modulus;
  if the modulus is literally repeated, say so: "the same key twice — gcd cannot split an
  identical modulus." This is also why Heninger et al. handled repeated keys (including Debian's)
  separately.
- No collisions at all (large `s`) → "no shared primes in this corpus" plus the prediction it
  matched. Not a failure state.
- `K` above the browser budget → refused with the measured reason, like `MAX_DIGITS` in
  `race.ts:39`. State plainly that the 40-digit cap applies to the Factor N input only; corpus
  moduli are full size because batch GCD does not depend on `N` being small.
- Cancel mid-tree → partial levels shown as cancelled; no recovered-prime verdict publishes
  afterwards (I7).

## Tests

- **Vitest:** `productTree` root equals the direct product; `remainderTree` matches `P mod N_i²`
  computed directly; `batchGcd` equals `pairwiseGcd` on 200 seeded corpora (independent route);
  the generator really reuses primes when `r` repeats; `r_p = r_q` is rejected; repeated modulus
  handled. KAT: none is published for batch GCD; pin seeded corpora and their expected
  recovered indices instead, and say so in `Build & Verify`.
- **`e2e/claims.spec.ts` additions:** parse every displayed modulus and recovered prime and
  assert `N mod p = 0` and `p` prime (Miller–Rabin written in the test, not imported); recompute
  pairwise gcds in the test from the displayed moduli and assert the set of compromised keys
  equals the page's; assert the "shares a prime with" column matches the test's own gcds;
  parts-sum-to-whole: the product-tree root's displayed bit length is within the expected range
  of the sum of the leaves' bit lengths; retirement when `s` changes; no-op guard.
- **Update** `e2e/gate.ts:280` (`.tab-btn` count 5 → 6) and extend the a11y gate's driven
  states through the new tab (generate, run, cancelled, no-collision) at 1280/380/320 px. Setup
  asserts structure only (§4.1a).
- **§4.1c mutations (five-step checklist, recorded in the PR):** (M1) remainder tree reduces mod
  `N_i` instead of `N_i²` → the batch-equals-pairwise test fails; (M2) the division by `N_i` is
  dropped → `g_i = N_i` everywhere and the compromised-set claim fails; (M3) `generateCorpus`
  ignores `r_p` and draws fresh randomness → the observed-collisions claim fails; (M4) corpus
  results bypass `verifyFactorization` → the verified-column test fails.
- **§4.1d negative claim:** *"No property of a single modulus reveals a shared prime — every
  per-key check this page can run passes, and the corpus still factors."* Fixture: the victim
  key's per-key audit (trial, Fermat, p−1, p+1 all give up under the stated params; `N` is not a
  perfect power per `describeShape`) — every rendered audit verdict "gave up" — and the same key
  marked compromised by batch GCD, with the negative-claim text visible in that state. Verdict
  shape: `PASSES EVERY PER-KEY CHECK — AND FACTORED`.

## README and card follow-up

- `What It Is`: one paragraph after the methods table — "one method needs many keys". Do not add
  it as an eighth row of the single-`N` table; its cost does not track any column there.
- `Exhibits`: add **8. Shared Primes** after 7.
- `What Can Go Wrong`: "Two devices boot with the same seed."
- `src/ui/shor.ts:79–81`: the `because` text says "not a method on this page" — now false. Keep
  the row (the count stays six, so `claims.spec.ts:635` is unaffected) and point it at the new
  tab. Sweep README and in-page copy for any other "not on this page" statement about batch GCD.
- Catalog handoff (do not edit `../crypto-lab`): chips may gain `Batch GCD`. RSA Forge's
  "Mining Your Ps and Qs" card should link here (see RSA Forge extension brief, same batch).

## Do not touch

`REGISTRY`, `ALGORITHM_ORDER`, the seven methods, `src/gen/weak.ts`, pinned vectors in
`src/factor/vectors.ts`, the verifier's import list, theme, header.

## Non-goals (each gets a one-line in-page note)

Scanning real keys from the internet · factoring repeated (identical) moduli · the boot-time
entropy model (extension seam) · scaled remainder trees and other Bernstein speedups · the number
field sieve.

## Sources

- Katz & Lindell, *Introduction to Modern Cryptography*, 3rd ed., CRC Press 2021,
  ISBN 9780815354369 — §12.5.6 "Randomness quality in RSA key generation" (the `r_p, r_q ∈ S`,
  `|S| = 2^s` model and the `2^{s/2}` birthday estimate), checked against the book text.
- N. Heninger, Z. Durumeric, E. Wustrow, J. A. Halderman, "Mining Your Ps and Qs: Detection of
  Widespread Weak Keys in Network Devices", 21st USENIX Security Symposium, 2012 — abstract: RSA
  private keys for 0.50% of TLS hosts and 0.03% of SSH hosts; 11,170,883 distinct moduli; 5.5 h on
  one core; quasilinear product/remainder-tree algorithm "due to Bernstein"; Debian weak keys
  excluded as repeated keys and reported separately. https://factorable.net/paper.html,
  https://factorable.net/weakkeys12.conference.pdf
- A. K. Lenstra, J. P. Hughes, M. Augier, J. W. Bos, T. Kleinjung, C. Wachter, "Ron was wrong,
  Whit is right", Cryptology ePrint Archive, Paper 2012/064. https://eprint.iacr.org/2012/064
  (the independent team K-L refers to; cite the ePrint — its published venue/title was not
  verified for this brief).
- D. J. Bernstein, "How to find smooth parts of integers", draft dated 2004-05-10 — product tree
  then remainder tree, Algorithm 2.1. Cite as a draft.
  https://nymity.ch/anomalous-tor-keys/bibliography/pdf/Bernstein04.pdf
