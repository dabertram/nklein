import { type PlanGapKind, planGapKindSchema } from "../../core/plan-gap";
import type { NKleinAcceptanceRepairAction } from "../../nklein-agent/nklein-acceptance-repair";

/**
 * Pure acceptance-failure → plan-gap classification for the `nklein task` CLI, extracted from the oversized `task.ts`
 * (todo §5.U). Given the outcome of an acceptance check (present? repair action? command/output/prompt), decides
 * whether the failure reflects a *plan-level* gap and, if so, classifies its `PlanGapKind` and builds the evidence
 * snippet. No I/O — just parsing/regex classification — so it is trivially unit-testable and keeps `task.ts` a thin
 * command registrar.
 */

export function parsePlanGapKind(value: string): PlanGapKind {
	return planGapKindSchema.parse(value);
}

export function shouldRecordAcceptancePlanGap(input: {
	acceptancePresent: boolean;
	repairAction: NKleinAcceptanceRepairAction | null;
}): boolean {
	return (
		input.acceptancePresent === false || input.repairAction === "escalate" || input.repairAction === "human_review"
	);
}

export function buildAcceptanceFailureEvidence(input: {
	command: string | null;
	output: string;
	taskPrompt: string;
}): string {
	return [
		input.command ? `Command: ${input.command}` : null,
		input.output.trim() ? `Output: ${input.output}` : null,
		!input.command && !input.output.trim() ? input.taskPrompt : null,
	]
		.filter((part): part is string => part !== null)
		.join("\n")
		.slice(0, 2_000);
}

const ACCEPTANCE_PLAN_GAP_CLASSIFIERS: readonly {
	kind: PlanGapKind;
	description: string;
	patterns: readonly RegExp[];
}[] = [
	{
		kind: "missing_decision",
		description:
			"Acceptance failed after repair attempts with output that points to an unresolved decision or ambiguity in the plan.",
		patterns: [
			/\b(ambiguous|unclear|needs clarification|need clarification|cannot determine|unable to determine)\b/,
			/\b(choose between|decide whether|requires a decision|requires user decision|confirm which|which .+ should)\b/,
			/\b(no default specified|missing product decision|missing design decision|unknown requirement)\b/,
		],
	},
	{
		kind: "contradictory_requirement",
		description:
			"Acceptance failed after repair attempts with output that points to contradictory or incompatible plan requirements.",
		patterns: [
			/\b(contradict|contradiction|conflicting requirement|mutually exclusive|incompatible requirement)\b/,
			/\b(conflicts with|cannot both|exclusive with|violates required invariant)\b/,
		],
	},
	{
		kind: "missing_dependency",
		description:
			"Acceptance failed after repair attempts with output that points to a missing dependency, config, schema, or file the plan did not provide.",
		patterns: [
			/\b(enoent|err_module_not_found|module not found|cannot find module|cannot find package)\b/,
			/\b(could not resolve|cannot resolve|failed to resolve|could not locate|no such file or directory)\b/,
			/\b(command not found|executable file not found|spawn .+ enoent|missing binary)\b/,
			/\b(missing required (environment variable|env var|config|configuration)|environment variable .+ is not set)\b/,
			/\b(api key|token|credential|secret) (is )?(missing|required|not set|undefined)\b/,
			/\b(relation .+ does not exist|table .+ does not exist|no such table|column .+ does not exist|missing migration)\b/,
		],
	},
	{
		kind: "scope_too_large",
		description:
			"Acceptance failed after repair attempts with output that suggests the task scope is too large for a single card.",
		patterns: [
			/\b(scope too large|too broad|timed out|timeout|out of memory|heap out of memory)\b/,
			/\b(context length exceeded|token limit|exceeded .+ limit|resource exhausted|too many files)\b/,
			/\b(complexity \d+\/\d+|split .+ before continuing|decompose .+ before continuing)\b/,
		],
	},
];

export function classifyAcceptanceFailurePlanGap(input: {
	acceptancePresent: boolean;
	repairAction: NKleinAcceptanceRepairAction | null;
	command: string | null;
	output: string;
	taskPrompt: string;
}): { kind: PlanGapKind; description: string; evidence: string } | null {
	if (
		!shouldRecordAcceptancePlanGap({
			acceptancePresent: input.acceptancePresent,
			repairAction: input.repairAction,
		})
	) {
		return null;
	}
	if (!input.acceptancePresent) {
		return {
			kind: "other",
			description:
				"Task is missing the required Acceptance check line, so the plan lacks a machine-checkable completion contract.",
			evidence: input.taskPrompt.slice(0, 2_000),
		};
	}

	const evidence = buildAcceptanceFailureEvidence(input);
	const normalizedOutput = input.output.toLowerCase();
	for (const classifier of ACCEPTANCE_PLAN_GAP_CLASSIFIERS) {
		if (classifier.patterns.some((pattern) => pattern.test(normalizedOutput))) {
			return {
				kind: classifier.kind,
				description: classifier.description,
				evidence,
			};
		}
	}
	return {
		kind: "other",
		description:
			"Acceptance repair attempts are exhausted; the task needs plan-level review before more implementation work.",
		evidence,
	};
}
