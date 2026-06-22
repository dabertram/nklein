/**
 * Acceptance-failure classification taxonomy (todo.md §5.G).
 *
 * When a card's acceptance command fails, "exit code N + 2000 chars of output" is hard to triage at a glance.
 * This pure classifier maps `(exitCode, output)` to a small, stable taxonomy with a human label and a short
 * next-step hint, so the diagnostics drawer (and auto-repair / run summaries) can show *why* it failed —
 * a missing test script vs. real test failures vs. a type error vs. a missing dependency are very different
 * situations with different fixes. Heuristic string/exit-code matching; ordered most-specific first.
 */

export type AcceptanceFailureCategory =
	| "command_not_found"
	| "missing_script"
	| "dependency_missing"
	| "type_error"
	| "lint_error"
	| "compile_error"
	| "test_failure"
	| "timeout"
	| "unknown";

export interface AcceptanceFailureClassification {
	category: AcceptanceFailureCategory;
	/** Short human label for the diagnostics drawer. */
	label: string;
	/** One-line next-step hint. */
	hint: string;
}

export interface ClassifyAcceptanceFailureInput {
	exitCode: number | null;
	output: string;
	/** True when the run was killed by the acceptance timeout (the gate knows this out of band). */
	timedOut?: boolean;
}

const CLASSIFIERS: Array<{
	category: AcceptanceFailureCategory;
	label: string;
	hint: string;
	matches: (input: { exitCode: number | null; text: string; timedOut: boolean }) => boolean;
}> = [
	{
		category: "timeout",
		label: "Timed out",
		hint: "The acceptance command exceeded its time budget. Speed up the check or raise the task timeout.",
		matches: ({ text, timedOut }) =>
			timedOut || text.includes("timed out") || text.includes("timeout") || text.includes("etimedout"),
	},
	{
		category: "command_not_found",
		label: "Command not found",
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
		label: "Missing script",
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
		label: "Missing dependency",
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
		label: "Type error",
		hint: "Type checking failed. Fix the reported type errors before the acceptance check can pass.",
		matches: ({ text }) =>
			/error ts\d{3,}/.test(text) || text.includes("tsc --noemit") || text.includes("type error"),
	},
	{
		category: "lint_error",
		label: "Lint error",
		hint: "A linter/formatter reported problems. Run the formatter/linter and fix the findings.",
		matches: ({ text }) =>
			text.includes("biome") ||
			text.includes("eslint") ||
			/\b\d+ (problem|error|warning)s? \(/.test(text) ||
			text.includes("lint"),
	},
	{
		category: "compile_error",
		label: "Compile/syntax error",
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
		label: "Test failures",
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
			return { category: classifier.category, label: classifier.label, hint: classifier.hint };
		}
	}
	return {
		category: "unknown",
		label: "Unclassified failure",
		hint: "The acceptance command failed for an unrecognized reason. Inspect the full output in the diagnostics drawer.",
	};
}
