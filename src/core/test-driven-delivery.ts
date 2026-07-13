/**
 * §5.AI — test-driven mode: the pure delivery-gate decision. When test-driven mode is ON, a task's change must
 * include a test change (a new/updated test file) before it may reach review — the agent has to write-or-update tests
 * for what it changed, not just ship code. This module is the pure decision + the test-file heuristic; the config
 * (global + per-project) and the acceptance-seam wiring are separate. Pure + total.
 */

/**
 * Whether a path looks like a test/spec file across the repo's conventions: a `.test.`/`.spec.` infix (ts/tsx/js/mjs/py),
 * a `__tests__/` or `/tests/`/`/test/` directory segment, or a `_test.`/`.test`-suffixed file. Conservative — matches
 * the shapes this repo + common ecosystems use, so a genuine test change is recognized while a plain source edit is not.
 */
export function isLikelyTestFile(path: string): boolean {
	const normalized = path.trim().replace(/\\/g, "/").toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	if (/(^|\/)(__tests__|tests?)\//.test(normalized)) {
		return true;
	}
	if (/\.(test|spec)\.[a-z]+$/.test(normalized)) {
		return true;
	}
	// Go/Python-style `_test.py` / `foo_test.go`.
	if (/_test\.[a-z]+$/.test(normalized)) {
		return true;
	}
	return false;
}

/**
 * F1.34 — the EXPLICIT intended default for test-driven mode: **OFF**. The eventual intent is stricter (a
 * test-backed change is the safe delivery), but flipping the default ON is gated on live fleet validation that
 * no-test changes bounce → re-drive → park correctly at scale; until then the safe default is the one that
 * cannot strand a board (OFF), and enabling is a deliberate global setting or per-project override.
 */
export const TEST_DRIVEN_MODE_DEFAULT = false;

/**
 * F1.34 — resolve the EFFECTIVE test-driven mode for a project: the per-project override wins when set (`true`/
 * `false` both meaningful — a project can opt OUT of a globally-on mode), else the global setting, else the
 * explicit default. Same `override ?? default` shape as every other per-project config override.
 */
export function resolveEffectiveTestDrivenMode(
	globalEnabled: boolean | undefined,
	projectOverride: boolean | null | undefined,
): boolean {
	if (projectOverride === true || projectOverride === false) {
		return projectOverride;
	}
	return globalEnabled === true ? true : TEST_DRIVEN_MODE_DEFAULT;
}

export interface TestDrivenDeliveryInput {
	/** Whether test-driven mode is enabled for this task (resolved: per-project override over the global default). */
	enabled: boolean;
	/** The paths the task's change touched (workspace-relative). */
	changedFilePaths: readonly string[];
}

export interface TestDrivenDeliveryDecision {
	/** True ⇒ the task may proceed to review; false ⇒ it must go back and add/adjust tests first. */
	allowReview: boolean;
	/** Whether the change actually touched a test file (surfaced for the reason + telemetry). */
	changedTests: boolean;
	/** A short, agent-readable reason when review is blocked (empty when allowed). */
	reason: string;
}

/**
 * Decide whether a change may reach review under test-driven mode. Disabled ⇒ always allowed (byte-identical to no
 * gate). Enabled ⇒ allowed only when the change touched at least one test file; otherwise blocked with a reason the
 * agent can act on (write/update a test for this change). Pure + total — an empty change with the mode on is blocked.
 */
export function decideTestDrivenDelivery(input: TestDrivenDeliveryInput): TestDrivenDeliveryDecision {
	const changedTests = input.changedFilePaths.some(isLikelyTestFile);
	if (!input.enabled) {
		return { allowReview: true, changedTests, reason: "" };
	}
	if (changedTests) {
		return { allowReview: true, changedTests: true, reason: "" };
	}
	return {
		allowReview: false,
		changedTests: false,
		reason:
			"Test-driven mode is on: this change touched no test file. Add or update a test that covers the change (and keep it green) before delivery.",
	};
}
