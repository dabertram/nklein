/**
 * F12.15b test-misinterpretation detector — the daplab failure pattern where a worker "fixes" a RED test run by
 * rewriting the TESTS instead of the code: a failing verification followed by edits that touch ONLY test files
 * is the signature (legitimate test-repair exists, so this is a record-only observation feeding reviewer
 * scrutiny, never a block). Pure over the caller-supplied event window; the context-focus extension owns the
 * per-session accumulation.
 */

export type TestMisinterpretationEvent =
	| { readonly kind: "red_run" }
	| { readonly kind: "edit"; readonly path: string };

export interface TestMisinterpretationVerdict {
	readonly flagged: boolean;
	readonly reason: string;
	/** Test-file edits observed since the red run (0 when not flagged). */
	readonly testEditCount: number;
}

const TEST_PATH_PATTERN = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

/** True when the workspace-relative path names a test file (directory or suffix convention). */
export function isTestFilePath(path: string): boolean {
	return TEST_PATH_PATTERN.test(path.trim());
}

/**
 * Assess the event window: flagged when the LATEST red run is followed by ≥2 edits, ALL of them test files.
 * One impl edit anywhere after the red run clears the pattern (the worker is fixing code, tests may move with
 * it); fewer than 2 test edits is too thin to call. No red run ⇒ nothing to assess.
 */
export function assessTestMisinterpretation(
	events: readonly TestMisinterpretationEvent[],
): TestMisinterpretationVerdict {
	let lastRedIndex = -1;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		if (events[index]?.kind === "red_run") {
			lastRedIndex = index;
			break;
		}
	}
	if (lastRedIndex === -1) {
		return { flagged: false, reason: "no red verification run in the window", testEditCount: 0 };
	}
	const editsAfter = events
		.slice(lastRedIndex + 1)
		.filter((event): event is { kind: "edit"; path: string } => event.kind === "edit");
	if (editsAfter.length < 2) {
		return { flagged: false, reason: "fewer than 2 edits after the red run — too thin to call", testEditCount: 0 };
	}
	const implEdits = editsAfter.filter((edit) => !isTestFilePath(edit.path));
	if (implEdits.length > 0) {
		return {
			flagged: false,
			reason: `implementation files edited after the red run (${implEdits.length}) — normal fix flow`,
			testEditCount: editsAfter.length - implEdits.length,
		};
	}
	return {
		flagged: true,
		reason: `after a RED verification run, ALL ${editsAfter.length} edits touched test files only — the failure may be getting "fixed" in the tests`,
		testEditCount: editsAfter.length,
	};
}
