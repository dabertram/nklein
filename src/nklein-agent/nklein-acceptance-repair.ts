import type { RuntimeModelRoles, RuntimeTaskNKleinSettings } from "../core/api-contract";
import type { NKleinAcceptanceGateResult } from "./nklein-acceptance-gate";

const DEFAULT_MAX_REPAIR_ATTEMPTS = 2;
const MAX_OUTPUT_PREVIEW_CHARS = 6_000;
const MAX_FAILURE_CONSTRAINT_CHARS = 1_200;

export type NKleinAcceptanceRepairAction = "repair" | "escalate" | "human_review";

export interface BuildNKleinAcceptanceRepairPlanInput {
	taskId: string;
	taskTitle?: string | null;
	taskPrompt: string;
	acceptance: NKleinAcceptanceGateResult;
	attempt: number;
	maxAttempts?: number;
	modelRoles?: RuntimeModelRoles;
}

export interface NKleinAcceptanceRepairPlan {
	action: NKleinAcceptanceRepairAction;
	attempt: number;
	maxAttempts: number;
	escalatedRole: "reviewer" | "architect" | null;
	escalatedSettings: RuntimeTaskNKleinSettings | null;
	prompt: string;
	summary: string;
}

function normalizeAttempt(value: number): number {
	if (!Number.isFinite(value) || value < 1) {
		return 1;
	}
	return Math.trunc(value);
}

function normalizeMaxAttempts(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value < 1) {
		return DEFAULT_MAX_REPAIR_ATTEMPTS;
	}
	return Math.trunc(value);
}

function trimOutputPreview(output: string): string {
	const normalized = output.trim();
	if (normalized.length <= MAX_OUTPUT_PREVIEW_CHARS) {
		return normalized;
	}
	return `${normalized.slice(0, MAX_OUTPUT_PREVIEW_CHARS)}\n[output truncated]`;
}

function trimFailureConstraint(value: string): string {
	const normalized = value
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
	if (normalized.length <= MAX_FAILURE_CONSTRAINT_CHARS) {
		return normalized;
	}
	return `${normalized.slice(0, MAX_FAILURE_CONSTRAINT_CHARS)}\n[constraint truncated]`;
}

export function extractAcceptanceFailureConstraint(output: string): string | null {
	const lines = output.replaceAll("\r\n", "\n").split("\n");
	const normalizedLines = lines.map((line) => line.trimEnd());
	const assertionIndex = normalizedLines.findIndex((line) =>
		/^(AssertionError|Error:\s+expect\(|Expected\s|Received\s|FAIL\s|\u2715\s|\u00d7\s|- Expected|- Received)/.test(
			line.trimStart(),
		),
	);
	if (assertionIndex >= 0) {
		const selectedLines = normalizedLines
			.slice(assertionIndex, assertionIndex + 8)
			.filter((line) => line.trim().length > 0);
		const constraint = trimFailureConstraint(selectedLines.join("\n"));
		return constraint.length > 0 ? constraint : null;
	}

	const compilerIndex = normalizedLines.findIndex((line) => /\b(error TS\d+|SyntaxError|TypeError):/.test(line));
	if (compilerIndex >= 0) {
		const selectedLines = normalizedLines
			.slice(compilerIndex, compilerIndex + 4)
			.filter((line) => line.trim().length > 0);
		const constraint = trimFailureConstraint(selectedLines.join("\n"));
		return constraint.length > 0 ? constraint : null;
	}

	const nonEmptyLine = normalizedLines.find((line) => line.trim().length > 0)?.trim() ?? "";
	return nonEmptyLine.length > 0 ? trimFailureConstraint(nonEmptyLine) : null;
}

function selectEscalationRole(
	modelRoles: RuntimeModelRoles | undefined,
): { role: "reviewer" | "architect"; settings: RuntimeTaskNKleinSettings } | null {
	const reviewer = modelRoles?.reviewer;
	if (reviewer && Object.keys(reviewer).length > 0) {
		return { role: "reviewer", settings: reviewer };
	}
	const architect = modelRoles?.architect;
	if (architect && Object.keys(architect).length > 0) {
		return { role: "architect", settings: architect };
	}
	return null;
}

function buildRepairPrompt(input: {
	taskTitle: string | null;
	taskPrompt: string;
	acceptance: NKleinAcceptanceGateResult;
	action: NKleinAcceptanceRepairAction;
	attempt: number;
	maxAttempts: number;
	escalatedRole: "reviewer" | "architect" | null;
}): string[] {
	const commandText = input.acceptance.command ?? "(missing Acceptance check)";
	const outputPreview = trimOutputPreview(input.acceptance.output);
	const failureConstraint = extractAcceptanceFailureConstraint(input.acceptance.output);
	const header =
		input.action === "repair"
			? `Acceptance check failed on repair attempt ${input.attempt} of ${input.maxAttempts}.`
			: input.action === "escalate"
				? `Acceptance check still failed; escalate this task to the ${input.escalatedRole ?? "reviewer"} role.`
				: "Acceptance check still failed after the allowed repair attempts; prepare a concise human handoff.";
	return [
		header,
		input.taskTitle ? `Task title: ${input.taskTitle}` : null,
		`Acceptance command: ${commandText}`,
		`Exit code: ${input.acceptance.exitCode ?? "unknown"}`,
		failureConstraint ? `Failing test constraint:\n${failureConstraint}` : null,
		outputPreview.length > 0 ? `Acceptance output:\n${outputPreview}` : "Acceptance output: (empty)",
		"",
		"Original task prompt:",
		input.taskPrompt.trim(),
		"",
		input.action === "human_review"
			? "Do not claim the task is complete. Summarize what failed, what you changed, and the next concrete debugging step for a human reviewer."
			: "Fix only the issue revealed by the acceptance failure, keep the original task scope, then rerun the exact Acceptance check before saying the task is complete.",
	].filter((part): part is string => part !== null);
}

export function buildNKleinAcceptanceRepairPlan(
	input: BuildNKleinAcceptanceRepairPlanInput,
): NKleinAcceptanceRepairPlan | null {
	if (input.acceptance.present !== true || input.acceptance.passed !== false) {
		return null;
	}

	const attempt = normalizeAttempt(input.attempt);
	const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
	const escalation = attempt > maxAttempts ? selectEscalationRole(input.modelRoles) : null;
	const action: NKleinAcceptanceRepairAction =
		attempt <= maxAttempts ? "repair" : escalation ? "escalate" : "human_review";
	const prompt = buildRepairPrompt({
		taskTitle: input.taskTitle?.trim() || null,
		taskPrompt: input.taskPrompt,
		acceptance: input.acceptance,
		action,
		attempt,
		maxAttempts,
		escalatedRole: escalation?.role ?? null,
	});

	return {
		action,
		attempt,
		maxAttempts,
		escalatedRole: escalation?.role ?? null,
		escalatedSettings: escalation?.settings ?? null,
		prompt: prompt.join("\n"),
		summary:
			action === "repair"
				? `Acceptance failed; retry repair attempt ${attempt} of ${maxAttempts}.`
				: action === "escalate"
					? `Acceptance failed after ${maxAttempts} repair attempts; retry with ${escalation?.role ?? "reviewer"} role.`
					: `Acceptance failed after ${maxAttempts} repair attempts; hand off for human review.`,
	};
}
