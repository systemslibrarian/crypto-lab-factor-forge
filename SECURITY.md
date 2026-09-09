# Security Policy

## What this project is

Factor Forge is an **educational demonstration**. It exists to show why RSA key generation says
what it says, by running seven classical factoring algorithms against numbers small enough to
finish in a browser tab while you watch — up to 40 digits, roughly 133 bits, against RSA's 2048.

**This is not production cryptography, and none of it should be used as though it were.** The
implementations are written to be read, not to be fast and not to be constant-time. The primality
test is probabilistic by design. The random number generation exists to make demonstrations
reproducible, not to be unpredictable. Copying any of this code into something that protects real
data would be a mistake, and no amount of care in this repository would make it not a mistake.

## There is no security support promise

This is a teaching demo maintained on a best-effort basis. There is no service level, no
guaranteed response time, no backported fix line, and no commitment to patch anything on a
schedule. Reports are read and acted on when they are correct and when there is time. Treat that
as the whole of the promise, because it is.

## What the shipped site actually is

The deployed site at <https://systemslibrarian.github.io/crypto-lab-factor-forge/> is a static
bundle on GitHub Pages. Concretely:

- **Zero runtime dependencies.** `package.json` has no `dependencies` block at all. Everything in
  `devDependencies` — Vite, TypeScript, Vitest, Playwright — is build-and-test tooling and none of
  it is in the bundle the browser downloads.
- **No backend.** There is no server, no API, no database. Every computation runs in the visitor's
  own browser, in a module Web Worker.
- **No user data leaves the machine.** There is no telemetry, no analytics, no cookies and no
  network call after the page and its worker chunk have loaded. The `N` you paste in, the
  parameters you set and every result are computed and displayed locally and are never
  transmitted. One thing IS written to browser storage: `localStorage.theme = "dark"`, set by the
  anti-flash script in `index.html` so the page does not flash light before the stylesheet loads.
  That is the whole of it — a single fixed string, no identifier, nothing derived from anything
  you typed. A permalink you choose to copy encodes the `N` and the bounds in the URL, which is
  the point of it; nothing puts them there unless you press the button.

### Install scripts are gated

`package.json` carries an `allowScripts` block naming every dependency permitted to run a
lifecycle script at install time, currently just `esbuild` (which downloads its platform
binary). This is npm's own mechanism -- `npm approve-scripts`, `npm config` keys
`allow-scripts` and `strict-allow-scripts` -- not a third-party wrapper, and npm 11 refuses to
run an unlisted package's install script without an explicit approval. It is the one place a
supply-chain compromise in the toolchain could execute code on a contributor's machine, so a
pull request that adds an entry here needs the same scrutiny as one that adds a dependency.

The practical consequence: the attack surface of the deployed site is the browser's own JavaScript
engine and GitHub Pages' static hosting. The classic web vulnerability classes — injection into a
backend, credential handling, session fixation, server-side deserialisation — have nowhere to
happen here.

## Reporting a mathematical defect

**This is the report this project most wants.** The lab makes arithmetic claims on screen, and a
wrong one is a real defect even though it is not a vulnerability. Please report:

- **A wrong factorization.** The page shows `p` and `q` for an `N` and `p × q ≠ N`.
- **A false primality verdict.** A factor announced as prime that is composite, or a composite `N`
  reported as prime.
- **A false claim on screen.** The "why it worked" text asserting a structural property the number
  does not have — a smoothness bound that does not hold, a Fermat step count that does not
  re-derive as `(p+q)/2 − ⌈√N⌉`, an ECM curve order outside Hasse's bound or inconsistent with its
  own printed factorization, a sieve congruence where `x² ≢ y² (mod N)` or where `x ≡ ±y`.
- **A method reporting a win it did not earn**, or reporting a give-up as an error.

Open a **public GitHub issue** for these. They are not exploitable, secrecy buys nothing, and a
public issue lets the next reader see the correction. Include:

1. The exact `N`, as digits.
2. The method and every parameter shown in the Parameters panel (bounds are part of the verdict).
3. What the page displayed, and what the correct value is.
4. The build identity from the page footer — version, commit and build date. Every run record and
   JSON export carries it, so an export is the easiest way to supply it.

A verified factorization that is wrong is a failure of invariant **I1**, and a "why it worked"
line that is wrong is a failure of invariant **I2** (see `README.md`). Either one is treated as a
gate failure, not a cosmetic bug.

## Reporting a conventional vulnerability

For anything that could harm a visitor — a cross-site scripting vector in how a pasted `N` or an
imported JSON export is rendered, a supply-chain problem in the build, a way to make the deployed
page load or execute code it does not ship — use **GitHub's private vulnerability reporting** on
this repository (the *Security* tab → *Report a vulnerability*). Do not open a public issue for
these first.

Include a proof of concept if you have one, the browser and version, and what an attacker gains.
Given the shape of the site, "what an attacker gains" is the part worth spelling out: with no
backend and no stored data, most findings resolve to something a visitor could already do to their
own browser tab.

## Known advisories in the toolchain

Recorded here rather than left to `npm audit` output, because the resolution needs an argument and
not just a version number.

### GHSA-82fw-gwwq-j7x9 — `@vitest/mocker` path traversal — RESOLVED

| | |
|---|---|
| Advisory | [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| Severity | Moderate, CVSS 3.1 base 5.9 (`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`), CWE-22 |
| Affected | `vitest` and `@vitest/mocker`, `>= 2.1.0 < 4.1.11` |
| First patched version | 4.1.11 |
| This repository | `vitest` `^5.0.0` — past the affected range |
| Status | Resolved. `npm audit` reports zero vulnerabilities. |

Kept here rather than deleted, because the argument is the part worth keeping.

**It was never reachable from the shipped site.** `vitest` is a `devDependency` and this site has
no runtime dependencies at all — no Vitest code is bundled by `vite build`, so no visitor to the
deployed page could execute any of it. The advisory was a risk to a *developer's* machine while
running the suite.

**It was not reachable here even in development.** The vulnerability is in the mocker's
redirect-mock path handling, and this repository's unit suite uses no mocking at all: no
`vi.mock`, no `vi.doMock`, no redirect mocks anywhere in `src/**/*.test.ts`. The tests run real
BigInt arithmetic against naive reference implementations, which is the point of them.

**On reading `npm audit` carefully.** The audit reported
`fixAvailable: { "name": "vitest", "version": "5.0.0", "isSemVerMajor": true }`. That is npm naming
the latest release it can reach, not the first release carrying the fix — the advisory's own
affected range ends at `< 4.1.11`. Anyone acting on the audit summary alone would have concluded a
two-major jump was mandatory. It was not; the two-major jump is simply what Dependabot proposed and
what the gate passed.

**How it was closed.** Dependabot opened the major as its own pull request, the full gate ran on
it, and the auto-merge job merged it on the strength of that gate — which is the policy working as
designed. The version and the lockfile moved in the same commit, which is the part that matters:
`npm ci` fails outright when `package.json` and `package-lock.json` disagree, so a range bumped by
hand without regenerating the lockfile turns every CI run red at the install step.

### An unapproved install script: `fsevents`

`npm ci` on macOS warns that `fsevents@2.3.3` has an install script not covered by `allowScripts`.
It is deliberately left unapproved. `fsevents` is a darwin-only optional dependency of Vite's file
watcher; it is absent on the Linux CI runner, the install succeeds without it, and approving an
install script that nothing here needs is the wrong default. The warning is npm's gate doing its
job, not a defect.

## Scope

In scope: the code in this repository and the site it deploys.

Out of scope: GitHub Pages itself, the browser you run it in, and the general observation that the
algorithms here are too slow and too small to threaten a real key. The last one is not a finding —
it is the entire premise, and `README.md` states it.
