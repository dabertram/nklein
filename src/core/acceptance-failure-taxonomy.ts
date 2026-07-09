/**
 * Acceptance-failure classification taxonomy (todo.md §5.G).
 *
 * When a card's acceptance command fails, "exit code N + 2000 chars of output" is hard to triage at a glance.
 * This pure classifier maps `(exitCode, output)` to a small, stable taxonomy with a human label and a short
 * next-step hint, so the diagnostics drawer (and auto-repair / run summaries) can show *why* it failed —
 * a missing test script vs. real test failures vs. a type error vs. a missing dependency are very different
 * situations with different fixes. Heuristic string/exit-code matching; ordered most-specific first.
 */

/** All classification slugs, ordered. Single source for the union type and the wire-contract zod enum. */
export const ACCEPTANCE_FAILURE_CATEGORIES = [
	"acceptance_setup_error",
	"command_not_found",
	"missing_script",
	"dependency_missing",
	"type_error",
	"lint_error",
	"compile_error",
	"test_failure",
	"timeout",
	"unknown",
] as const;

export type AcceptanceFailureCategory = (typeof ACCEPTANCE_FAILURE_CATEGORIES)[number];

export interface AcceptanceFailureClassification {
	category: AcceptanceFailureCategory;
	/** Short human label for the diagnostics drawer. */
	label: string;
	/** One-line next-step hint. */
	hint: string;
}

/**
 * Authoritative category → short human label map. The single source of truth for failure labels so the
 * server classifier and the UI (which only persists the category slug) render identical copy.
 */
export const ACCEPTANCE_FAILURE_LABELS: Record<AcceptanceFailureCategory, string> = {
	acceptance_setup_error: "Acceptance setup error",
	command_not_found: "Command not found",
	missing_script: "Missing script",
	dependency_missing: "Missing dependency",
	type_error: "Type error",
	lint_error: "Lint error",
	compile_error: "Compile/syntax error",
	test_failure: "Test failures",
	timeout: "Timed out",
	unknown: "Unclassified failure",
};

/** Short human label for a classified acceptance-failure category. */
export function acceptanceFailureCategoryLabel(category: AcceptanceFailureCategory | null | undefined): string {
	return category ? ACCEPTANCE_FAILURE_LABELS[category] : ACCEPTANCE_FAILURE_LABELS.unknown;
}

export interface ClassifyAcceptanceFailureInput {
	exitCode: number | null;
	output: string;
	/** True when the run was killed by the acceptance timeout (the gate knows this out of band). */
	timedOut?: boolean;
}

const CLASSIFIERS: Array<{
	category: AcceptanceFailureCategory;
	hint: string;
	matches: (input: { exitCode: number | null; text: string; timedOut: boolean }) => boolean;
}> = [
	{
		category: "timeout",
		hint: "The acceptance command exceeded its time budget. Speed up the check or raise the task timeout.",
		matches: ({ text, timedOut }) =>
			timedOut || text.includes("timed out") || text.includes("timeout") || text.includes("etimedout"),
	},
	{
		category: "acceptance_setup_error",
		hint: "The acceptance command could not enter its configured sandbox working directory. Fix the Acceptance check path or rerun it from the sandbox root.",
		matches: ({ text }) =>
			(/\bcd:\s+.*(can'?t cd|cannot cd|no such file or directory)/s.test(text) && text.includes("/workspaces/")) ||
			(/\b(chdir|cwd)\b/.test(text) && text.includes("/workspaces/") && text.includes("no such file or directory")),
	},
	{
		category: "command_not_found",
		hint: "The acceptance command's executable is not on PATH in the sandbox. Use a command the project provides (e.g. npm test).",
		matches: ({ exitCode, text }) =>
			exitCode === 127 ||
			text.includes("command not found") ||
			text.includes("is not recognized as an internal or external command") ||
			text.includes("no such file or directory") ||
			/\bnot found\b/.test(text),
	},
	{
		category: "missing_script",
		hint: "The package/task script does not exist. Add the script or point the acceptance command at one that exists.",
		matches: ({ text }) =>
			text.includes("missing script") ||
			text.includes("npm error missing script") ||
			text.includes("no test specified") ||
			text.includes("unknown task") ||
			text.includes("no such task"),
	},
	{
		category: "dependency_missing",
		hint: "A required module/package is not installed. Add it as a card dependency or install step before the acceptance check.",
		matches: ({ text }) =>
			text.includes("cannot find module") ||
			text.includes("module not found") ||
			text.includes("modulenotfounderror") ||
			text.includes("importerror") ||
			text.includes("cannot find package") ||
			/\beresolve\b/.test(text) ||
			text.includes("could not resolve"),
	},
	{
		category: "type_error",
		hint: "Type checking failed. Fix the reported type errors before the acceptance check can pass.",
		matches: ({ text }) =>
			/error ts\d{3,}/.test(text) || text.includes("tsc --noemit") || text.includes("type error"),
	},
	{
		category: "lint_error",
		hint: "A linter/formatter reported problems. Run the formatter/linter and fix the findings.",
		matches: ({ text }) =>
			text.includes("biome") ||
			text.includes("eslint") ||
			/\b\d+ (problem|error|warning)s? \(/.test(text) ||
			text.includes("lint"),
	},
	{
		category: "compile_error",
		hint: "The code failed to compile/parse. Fix the syntax/build error.",
		matches: ({ text }) =>
			text.includes("syntaxerror") ||
			text.includes("compilation failed") ||
			text.includes("compile error") ||
			text.includes("unexpected token") ||
			text.includes("parse error"),
	},
	{
		category: "test_failure",
		hint: "Tests ran but some failed. Inspect the failing assertions and fix the implementation or the test.",
		matches: ({ text }) =>
			/\bfail(s|ed|ing|ure)?\b/.test(text) ||
			text.includes("assertionerror") ||
			text.includes("expect(") ||
			text.includes("✕") ||
			text.includes("✗"),
	},
];

export function classifyAcceptanceFailure(input: ClassifyAcceptanceFailureInput): AcceptanceFailureClassification {
	const text = input.output.toLowerCase();
	const timedOut = input.timedOut === true;
	for (const classifier of CLASSIFIERS) {
		if (classifier.matches({ exitCode: input.exitCode, text, timedOut })) {
			return {
				category: classifier.category,
				label: ACCEPTANCE_FAILURE_LABELS[classifier.category],
				hint: classifier.hint,
			};
		}
	}
	return {
		category: "unknown",
		label: ACCEPTANCE_FAILURE_LABELS.unknown,
		hint: "The acceptance command failed for an unrecognized reason. Inspect the full output in the diagnostics drawer.",
	};
}
