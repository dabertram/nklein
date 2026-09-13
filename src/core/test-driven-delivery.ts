/**
 * §5.AI — test-driven mode: the pure delivery-gate decision. When test-driven mode is ON, a task's change must
 * include a test change (a new/updated test file) before it may reach review — the agent has to write-or-update tests
 * for what it changed, not just ship code. This module is the pure decision + the test-file heuristic; the config
 * (global + per-project) and the acceptance-seam wiring are separate. Pure + total.
 */

/** Source extensions a test file can carry. Data/markup extensions never make a test, whatever the file is named. */
const TEST_FILE_CODE_EXTENSION = "(?:[cm]?[jt]sx?|py|go|rs|rb|java|kt|kts|cs|swift|php|scala|exs?|dart|lua|pl|sh)";
const TEST_FILE_INFIX_PATTERN = new RegExp(`\\.(test|spec)\\.${TEST_FILE_CODE_EXTENSION}$`);
const TEST_FILE_UNDERSCORE_SUFFIX_PATTERN = new RegExp(`_test\\.${TEST_FILE_CODE_EXTENSION}$`);
const TEST_FILE_CODE_EXTENSION_PATTERN = new RegExp(`^${TEST_FILE_CODE_EXTENSION}$`);
const TEST_DIRECTORY_SEGMENT_PATTERN = /(^|\/)(__tests__|tests?)(\/|$)/;
const GLOB_METACHARACTER_PATTERN = /[*?[\]{}]/;

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
	// The infix/suffix rules need a CODE extension: `fixtures/foo.test.json` or `api.spec.yaml` are data a test reads,
	// not tests — counting them let a `spec/*.json` deliverable satisfy the gate by its file name alone (P1.UNSATGATE).
	if (TEST_FILE_INFIX_PATTERN.test(normalized)) {
		return true;
	}
	// Go/Python-style `_test.py` / `foo_test.go`.
	if (TEST_FILE_UNDERSCORE_SUFFIX_PATTERN.test(normalized)) {
		return true;
	}
	return false;
}

/**
 * P1.UNSATGATE — can a write scope reach ANY file `isLikelyTestFile` would accept? The test-driven gate demands a
 * touched test file, and a card whose bounds cannot contain one can neither pass nor legally stop (live 2026-09-10/11,
 * projects 50/51: every card's scope was the deliverable — `spec/*.json` — while `test/` was digest-frozen evidence;
 * 23 of one shift's 40 requests went to a card that was correct, green and refused). The decomposer infers
 * `not_testable` from this, and the gate itself steps aside on it, so the runtime never demands the impossible.
 *
 * CONSERVATIVE by construction — false only when EVERY entry provably cannot hold a test file:
 *   - an exact file path (a leaf with an extension, no glob) that is not itself a test file;
 *   - a glob without `**`, without a test directory segment, whose leaf pins a NON-code extension
 *     (`spec/*.json`, `docs/*.md`) — the only names it can match are data files.
 * Everything uncertain — a directory, `src/**`, `spec/*`, a test directory, an empty scope — reads as reachable, so
 * the strict `testable` default stands wherever a test COULD be written.
 */
export function writeScopeCanReachTestFile(writeScope: readonly string[]): boolean {
	const entries = writeScope.map((entry) => entry.trim().replace(/\\/g, "/").toLowerCase()).filter(Boolean);
	if (entries.length === 0) {
		return true;
	}
	return entries.some((entry) => {
		if (isLikelyTestFile(entry) || TEST_DIRECTORY_SEGMENT_PATTERN.test(entry)) {
			return true;
		}
		const leaf = entry.replace(/\/+$/, "").split("/").at(-1) ?? "";
		if (GLOB_METACHARACTER_PATTERN.test(entry)) {
			if (entry.includes("**")) {
				return true;
			}
			// A glob whose leaf pins an extension can only ever match files of that extension.
			const pinnedExtension = /\.([a-z0-9]+)$/.exec(leaf)?.[1];
			return !pinnedExtension || TEST_FILE_CODE_EXTENSION_PATTERN.test(pinnedExtension);
		}
		// A directory (no extension on the leaf) can hold a co-located test; an exact non-test file cannot.
		return leaf.length === 0 || !leaf.includes(".");
	});
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
	/**
	 * P1.UNSATGATE: the card's write bounds (explicit `writeScope`, else `filesLikelyTouched`). When they provably
	 * cannot contain a test file, demanding one is demanding the impossible — the gate steps aside, audited.
	 */
	writeScope?: readonly string[];
}

export interface TestDrivenDeliveryDecision {
	/** True ⇒ the task may proceed to review; false ⇒ it must go back and add/adjust tests first. */
	allowReview: boolean;
	/** Whether the change actually touched a test file (surfaced for the reason + telemetry). */
	changedTests: boolean;
	/** True ⇒ the gate stepped aside because the card was declared not-testable upfront (audited, never silent). */
	skippedNonTestable: boolean;
	/** True ⇒ the gate stepped aside because the card's write scope cannot contain a test file (P1.UNSATGATE, audited). */
	skippedScopeCannotContainTest: boolean;
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
/**
 * A VERIFICATION-ONLY card (live 2026-09-05, `s44a-…-wallclock-allowlist`: "Verification slice of S44a (no new
 * product code): prove that … the S02 no-wallclock guard still passes") delivers evidence, not a diff — the
 * test-driven gate bounced its worker eight rounds in a row for "touched no test file" until the loop guard
 * parked it for a human. The prompt says what kind of card it is; read that instead of demanding a test.
 */
export function isVerificationOnlyPrompt(prompt: string | null | undefined): boolean {
	const text = (prompt ?? "").slice(0, 1_500);
	return (
		/\bverification slice\b/iu.test(text) ||
		/\bno new product code\b/iu.test(text) ||
		/\b(?:prove|verify|confirm) that\b[^.\n]{0,160}\b(?:still|remains?|passes|green)\b/iu.test(text) ||
		/\bverification[- ]only\b/iu.test(text)
	);
}

export function decideTestDrivenDelivery(input: TestDrivenDeliveryInput): TestDrivenDeliveryDecision {
	const changedTests = input.changedFilePaths.some(isLikelyTestFile);
	const notSkipped = { skippedNonTestable: false, skippedScopeCannotContainTest: false };
	if (!input.enabled) {
		return { allowReview: true, changedTests, ...notSkipped, reason: "" };
	}
	if (input.testability === "not_testable") {
		return { allowReview: true, changedTests, ...notSkipped, skippedNonTestable: true, reason: "" };
	}
	if (changedTests) {
		return { allowReview: true, changedTests: true, ...notSkipped, reason: "" };
	}
	// P1.UNSATGATE: bounds that cannot hold a test file make the demand below unsatisfiable — step aside, audited.
	if (input.writeScope && input.writeScope.length > 0 && !writeScopeCanReachTestFile(input.writeScope)) {
		return { allowReview: true, changedTests: false, ...notSkipped, skippedScopeCannotContainTest: true, reason: "" };
	}
	return {
		allowReview: false,
		changedTests: false,
		...notSkipped,
		reason:
			"Test-driven mode is on: this change touched no test file. Add or update a test that covers the change (and keep it green) before delivery. If this card is genuinely not testable, its testability must be declared not_testable on the card (by the plan or the operator), not worked around.",
	};
}
