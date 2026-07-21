import { createHash } from "node:crypto";
import { loadWorkspaceState } from "../state/workspace-state";
import {
	appendNKleinPlanRevision,
	type NKleinPlanQuestion,
	readNKleinPlanArtifacts,
	updateNKleinPlanQuestion,
} from "./nklein-plan-artifacts";

export interface ExecutionClarificationAsk {
	taskId: string;
	question: string;
	options: string[];
}

export type ExecutionClarificationBlockResult =
	| { status: "recorded"; planSlug: string; questionId: string; created: boolean; revisionRecorded: boolean }
	| { status: "skipped"; reason: "card_not_found" | "not_plan_card" | "empty_question" };

function normalizeQuestion(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function executionQuestionId(taskId: string, question: string, at: number): string {
	const digest = createHash("sha256").update(`${taskId}\0${question}\0${at}`).digest("hex").slice(0, 12);
	return `execution-ask-${digest}`;
}

function toQuestionOptions(labels: readonly string[]): NKleinPlanQuestion["options"] {
	const seen = new Set<string>();
	return labels.flatMap((value, index) => {
		const label = value.trim();
		const key = label.toLowerCase();
		if (!label || seen.has(key)) {
			return [];
		}
		seen.add(key);
		return [{ id: `option-${index + 1}`, label, description: null, recommended: index === 0 }];
	});
}

/**
 * F1.3e execution-side block setter. A plan-born worker's native ask parks that exact card in the session layer; this
 * persists the question onto its originating plan with `blockedTaskId`, completing the durable answer→resume link.
 */
export async function recordExecutionClarificationBlock(input: {
	workspacePath: string;
	ask: ExecutionClarificationAsk;
	now?: () => number;
	loadState?: typeof loadWorkspaceState;
	readArtifacts?: typeof readNKleinPlanArtifacts;
	updateQuestion?: typeof updateNKleinPlanQuestion;
	appendRevision?: typeof appendNKleinPlanRevision;
}): Promise<ExecutionClarificationBlockResult> {
	const questionText = input.ask.question.trim();
	if (!questionText) {
		return { status: "skipped", reason: "empty_question" };
	}
	const state = await (input.loadState ?? loadWorkspaceState)(input.workspacePath);
	const card = state.board.columns
		.flatMap((column) => column.cards)
		.find((candidate) => candidate.id === input.ask.taskId);
	if (!card) {
		return { status: "skipped", reason: "card_not_found" };
	}
	const origin = card.generatedFromPlan;
	if (!origin) {
		return { status: "skipped", reason: "not_plan_card" };
	}
	const readArtifacts = input.readArtifacts ?? readNKleinPlanArtifacts;
	const artifacts = await readArtifacts(input.workspacePath, origin.planSlug);
	const normalized = normalizeQuestion(questionText);
	const existing = artifacts.questions.find(
		(question) => question.status === "open" && normalizeQuestion(question.question) === normalized,
	);
	const at = (input.now ?? Date.now)();
	const question: NKleinPlanQuestion = existing
		? { ...existing, blockedTaskId: input.ask.taskId }
		: {
				id: executionQuestionId(input.ask.taskId, questionText, at),
				question: questionText,
				status: "open",
				options: toQuestionOptions(input.ask.options),
				answer: null,
				assumption: null,
				blockedTaskId: input.ask.taskId,
			};
	await (input.updateQuestion ?? updateNKleinPlanQuestion)({
		workspacePath: input.workspacePath,
		slug: origin.planSlug,
		question,
	});
	await (input.appendRevision ?? appendNKleinPlanRevision)({
		workspacePath: input.workspacePath,
		slug: origin.planSlug,
		taskId: input.ask.taskId,
		kind: "clarification_blocked",
		description: `Task ${input.ask.taskId} paused for clarification: ${questionText.replaceAll("\n", " ").slice(0, 300)}`,
		evidence: `native tool: ask_followup_question; question id: ${question.id}`,
		createdAt: at,
	});
	return {
		status: "recorded",
		planSlug: origin.planSlug,
		questionId: question.id,
		created: !existing,
		revisionRecorded: true,
	};
}
