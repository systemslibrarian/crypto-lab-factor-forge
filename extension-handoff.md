# Factor Forge — shared-prime corpus extension

Brief: `brief-extension.md`. Slug: `crypto-lab-factor-forge`.
Starting main: `8fd7436210e07440c04e36397e1432fc25cafb79`.
Pages: https://systemslibrarian.github.io/crypto-lab-factor-forge/

## Delivered

The sixth tab, Shared Primes, generates replayable corpora of 2–128 RSA moduli
from deliberately small prime-seed spaces. It uses existing prime generation,
seeded randomness, worker infrastructure and the independent factor verifier.
Only public moduli reach the attack. Product and remainder trees show real node
bit lengths, batch GCD computes gcd(N, (P mod N²)/N), and the g=N case performs
a public pairwise fallback. Identical moduli are named without pretending that
gcd(N,N) supplies a proper factor. The naive route is independently computed,
with actual comparison counts and measured timings, not projected speedups.

The birthday forecast is explicitly the independent-draw model before rejecting
equal primes within a key. Seed-draw pairs and public key-sharing pairs are
separate measured quantities. Generation supports 256/512/1024-bit primes;
the 128-key cap and worker cancellation keep the experiment bounded. Actual
generation measurements are in `corpus-local-measurements.json`.

Per-key audits run original trial division, Fermat, p−1 and p+1 with their
default parameters and a displayed 200 ms cap each. The negative fixture says
these bounded searches gave up while the same public key was recovered from
the corpus. This intentionally corrects the brief's overbroad claim that four
give-ups certify per-key security. The visible warning names that limitation.

Exports and permalinks carry the complete experiment context and build ID.
Inputs retire results, bad URLs are refused before controls can clamp them,
and cancellation cannot publish a late verdict. The existing seven-method
registry, algorithm ordering, primitive methods, pinned vectors, verifier,
header, theme and workflow remain unchanged. The Shor tab's now-outdated
“not on this page” description is corrected without changing its table shape.

## Verification

- 156 unit tests passed; 200 seeded corpora agree with independent pairwise
  GCD on every raw GCD and factor. Product/remainder levels are independently
  recomputed; repeated/full-sharing cases, birthday fractions and verifier
  invocation are covered. A 12-modulus seeded replay fixture pins generation.
- §4.1a: six-tab and lazy-panel structural assertions; no copy in boot.
- §4.1b: 88 local browser tests passed, including all existing claims and the
  five new claims on desktop and mobile. The tests independently derive GCDs,
  primality, tree bit lengths, sharing relationships and recovery counts from
  displayed public moduli; test negative evidence, refusal, cancellation,
  export and permalink context; and check compromised verdicts are alarms.
- §4.1c: 6/6 concrete mutations killed; `mutation-evidence.json` records each
  passing baseline, source patch, changed build SHA-256, named zero-retry
  assertion failure and exact restored build with a passing owning test.
  Wrong-modulus and missing-division tests check the intermediate raw GCD,
  because the required g=N fallback can otherwise mask those arithmetic bugs.
  Browser mutation runs verify the served script's identity before accepting
  an assertion kill. No browser asset mismatch is counted as a kill.
- §4.1d: four actual bounded give-ups, a non-perfect-power public modulus and
  a verified proper factor coexist with the visible warning. Deleting that
  sentence fails its owning browser test.
- Accessibility passed at desktop, 380px and 320px, including generated,
  recovered, no-collision, audit and cancellation states; forced-colour gate
  passed. The entropy slider's native margin was fixed; no baseline exemption
  was added. Narrow result and colour-deficiency views were inspected.
- Local Chromium 153.0.8010.0 used an ignored config because the pinned browser
  download was unavailable. CI's original browsers and workflow are preserved.
- Primary sources checked: Heninger et al., USENIX Security 2012, §3.3 Algorithm
  1 and the full-GCD fallback; Lenstra et al., IACR ePrint 2012/064; Bernstein's
  2004 factoring-into-coprimes draft. Debian key enumeration is distinguished
  from shared-prime recovery; no source is credited with invented test data.

## Catalog handoff — no shared catalog edits

Suggested card sentence: “Generate weak-entropy RSA key corpora, watch product
and remainder trees recover shared primes, and compare batch GCD with bounded
single-key searches.”
Add chip `Batch GCD`; retain the existing chips.
Implemented algorithms: `src/corpus/batchgcd.ts` product/remainder trees,
batch GCD with public fallback and independent pairwise GCD;
`src/corpus/generate.ts` replayable seeded prime corpus;
`src/corpus/birthday.ts` exact birthday-model probability;
`src/corpus/verify.ts` original independent verification boundary.
Teaching model only: low entropy prime seeds; no claim to simulate a particular
historical vendor's generator. No new single-number factoring method.
Concept deepened: **7. Factoring**.

Final main SHA and served-byte proof are recorded after publication. The shared
fleet deploy-sync checker is blocked by missing unrelated sibling clones;
shared catalog, counsel, census and checker content remain unchanged.
