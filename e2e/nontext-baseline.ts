/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy -- hand-measure before acting on it.
 *
 * IT IS EMPTY, AND THAT IS THE POINT -- this is the terminal state of the
 * ratchet, not an unrun check. The palette was chosen against this oracle
 * rather than fixed up afterwards: `--control-border` (#626d7a) was picked to
 * clear 3:1 on all three surfaces this page paints controls on (3.59:1 on
 * `--bg`, 3.28:1 on `--surface`, 3.03:1 on `--surface-2`), `.btn-primary`
 * borders in `--accent-text` rather than repainting its own fill colour, the
 * selected `.tab-btn` carries an `--accent` fill that clears its surround, and
 * the SVG charts draw their axes in `--control-border` instead of
 * `currentColor` at an opacity. The shared top bar's `.cl-btn`, baselined in
 * older labs at ~1.49:1, already draws its edge from `--cl-ink` and clears 3:1
 * -- which is why the two entries most of this fleet carries are absent too.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this
 * same path and asserts nothing, which is how this file is regenerated; the
 * capture run for this lab printed zero findings.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
