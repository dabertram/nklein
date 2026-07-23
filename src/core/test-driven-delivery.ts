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
 * F1.34 — the EXPLICIT default for test-driven mode: **ON** (David 2026-07-23). The bounce → re-work → park
 * contract was proven deterministically (aimock test-driven drains, all-40 invariant), and the directive is to
 * run the way a human developer team would: testable work ships with tests by default, and work that cannot be
 * tested is DECLARED not-testable upfront (per-card `testability`, decompose-time or operator-set) rather than
 * the whole gate defaulting off. Global setting and per-project override remain the explicit escape hatches.
 */
export const TEST_DRIVEN_MODE_DEFAULT = true;

/**
 * F1.34 — resolve the EFFECTIVE test-driven mode for a project: the per-project override wins when set (`true`/
 * `false` both meaningful — a project can opt OUT of a globally-on mode), else the explicit global setting
 * (`true`/`false` both meaningful for the same reason), else the default. Same `override ?? default` shape as
 * every other per-project config override.
 */
export function resolveEffectiveTestDrivenMode(
	globalEnabled: boolean | undefined,
	projectOverride: boolean | null | undefined,
): boolean {
	if (projectOverride === true || projectOverride === false) {
		return projectOverride;
	}
	if (globalEnabled === true || globalEnabled === false) {
		return globalEnabled;
	}
	return TEST_DRIVEN_MODE_DEFAULT;
}

/**
 * F1.34b-ext (David 2026-07-23) — a card's UPFRONT testability declaration. `testable` (and absent, the strict
 * default) means the test-driven gate applies: the change must include a test change before review.
 * `not_testable` means the card was KNOWN and DECLARED upfront to be work automated tests cannot cover (pure
 * docs, assets, config-only wiring verified by build, exploratory spikes) — for those, skipping tests is
 * legitimate and the gate steps aside, visibly. The declaration is made at decompose time by the architect or
 * by the operator on the card — never by the worker being gated, which would let it self-exempt.
 */
export type TaskTestability = "testable" | "not_testable";

export interface TestDrivenDeliveryInput {
	/** Whether test-driven mode is enabled for this task (resolved: per-project override over the global default). */
	enabled: boolean;
	/** The paths the task's change touched (workspace-relative). */
	changedFilePaths: readonly string[];
	/** The card's upfront testability declaration; absent ⇒ `testable` (the strict default). */
	testability?: TaskTestability;
}

export interface TestDrivenDeliveryDecision {
	/** True ⇒ the task may proceed to review; false ⇒ it must go back and add/adjust tests first. */
	allowReview: boolean;
	/** Whether the change actually touched a test file (surfaced for the reason + telemetry). */
	changedTests: boolean;
	/** True ⇒ the gate stepped aside because the card was declared not-testable upfront (audited, never silent). */
	skippedNonTestable: boolean;
	/** A short, agent-readable reason when review is blocked (empty when allowed). */
	reason: string;
}

/**
 * Decide whether a change may reach review under test-driven mode. Disabled ⇒ always allowed (byte-identical to no
 * gate). Enabled + declared `not_testable` ⇒ allowed with `skippedNonTestable` set so the skip is auditable.
 * Enabled otherwise ⇒ allowed only when the change touched at least one test file; otherwise blocked with a reason
 * the agent can act on (write/update a test for this change). Pure + total — an empty change with the mode on is
 * blocked.
 */
export function decideTestDrivenDelivery(input: TestDrivenDeliveryInput): TestDrivenDeliveryDecision {
	const changedTests = input.changedFilePaths.some(isLikelyTestFile);
	if (!input.enabled) {
		return { allowReview: true, changedTests, skippedNonTestable: false, reason: "" };
	}
	if (input.testability === "not_testable") {
		return { allowReview: true, changedTests, skippedNonTestable: true, reason: "" };
	}
	if (changedTests) {
		return { allowReview: true, changedTests: true, skippedNonTestable: false, reason: "" };
	}
	return {
		allowReview: false,
		changedTests: false,
		skippedNonTestable: false,
		reason:
			"Test-driven mode is on: this change touched no test file. Add or update a test that covers the change (and keep it green) before delivery. If this card is genuinely not testable, its testability must be declared not_testable on the card (by the plan or the operator), not worked around.",
	};
}
