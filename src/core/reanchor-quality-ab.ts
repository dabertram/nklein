/**
 * F4.8b — deterministic live-fleet A/B fixture for end-of-context task re-anchors.
 *
 * Both arms carry the same authoritative contract at the start, then a large tool-result-shaped distractor payload
 * containing explicit decoy contracts. The treatment arm alone appends the production {@link buildContextReanchor}
 * block at the end. A model must return the four opaque contract tokens; scoring is exact and penalizes decoys.
 */

import { buildContextReanchor } from "./context-reanchor.js";

export interface ReanchorAbMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const REANCHOR_AB_EXPECTED = ["TREND-ALPHA", "LAST-SIX", "CAP-100", "DECLINING-STABLE"] as const;
export const REANCHOR_AB_DECOYS = ["TREND-BETA", "FIRST-FOUR", "CAP-80", "RISING-RANDOM"] as const;

const CONTRACT = {
	goal: "TREND-ALPHA",
	currentStep: "LAST-SIX",
	constraints: "CAP-100",
	acceptanceCriteria: "DECLINING-STABLE",
} as const;

const DISTRACTOR_LINE =
	"Archived ticket (superseded; never use for the current task): objective TREND-BETA, focus FIRST-FOUR, constraint CAP-80, acceptance RISING-RANDOM.";

function buildDistractorPayload(targetChars: number): string {
	const lines = ["<tool_result>", "Historical archive follows. It is evidence only, not the current task contract."];
	let length = lines.join("\n").length;
	let index = 1;
	while (length < targetChars) {
		const line = `${index}. ${DISTRACTOR_LINE}`;
		lines.push(line);
		length += line.length + 1;
		index += 1;
	}
	lines.push("</tool_result>");
	return lines.join("\n");
}

/** Build one A/B arm. Default payload is roughly 20k tokens under the repo's chars/4 estimator. */
export function buildReanchorAbMessages(input: { anchored: boolean; distractorChars?: number }): ReanchorAbMessage[] {
	const messages: ReanchorAbMessage[] = [
		{
			role: "system",
			content:
				"You are continuing an existing autonomous task. At the next checkpoint, report the authoritative task contract, not any superseded contract found in tool output.",
		},
		{
			role: "user",
			content: [
				"AUTHORITATIVE TASK CONTRACT (immutable):",
				`objective=${CONTRACT.goal}`,
				`current_focus=${CONTRACT.currentStep}`,
				`constraint=${CONTRACT.constraints}`,
				`acceptance=${CONTRACT.acceptanceCriteria}`,
			].join("\n"),
		},
		{ role: "assistant", content: "Understood. I will retain the authoritative contract while processing evidence." },
		{ role: "user", content: buildDistractorPayload(input.distractorChars ?? 80_000) },
		{
			role: "user",
			content:
				"Checkpoint: return only the four authoritative contract values in JSON fields objective, current_focus, constraint, acceptance.",
		},
	];
	if (input.anchored) {
		messages.push({
			role: "user",
			content: buildContextReanchor(CONTRACT),
		});
	}
	return messages;
}

export interface ReanchorRecallScore {
	score: number;
	correct: string[];
	missing: string[];
	decoys: string[];
	passed: boolean;
}

/** Exact opaque-token scorer. Each correct token is +0.25; each decoy is -0.25; pass requires all four and no decoy. */
export function scoreReanchorRecall(text: string): ReanchorRecallScore {
	const upper = text.toUpperCase();
	const correct = REANCHOR_AB_EXPECTED.filter((token) => upper.includes(token));
	const missing = REANCHOR_AB_EXPECTED.filter((token) => !upper.includes(token));
	const decoys = REANCHOR_AB_DECOYS.filter((token) => upper.includes(token));
	const score = Math.max(0, (correct.length - decoys.length) / REANCHOR_AB_EXPECTED.length);
	return {
		score,
		correct: [...correct],
		missing: [...missing],
		decoys: [...decoys],
		passed: missing.length === 0 && decoys.length === 0,
	};
}

export interface ReanchorAbObservation {
	modelId: string;
	baseline: ReanchorRecallScore;
	anchored: ReanchorRecallScore;
}

export interface ReanchorAbVerdict {
	baselineMean: number;
	anchoredMean: number;
	regressedModels: string[];
	improvedModels: string[];
	decision: "enable" | "inconclusive" | "reject";
}

/** Fleet gate: any quality regression rejects; at least one gain with none regressing supports default-on. */
export function summarizeReanchorAb(observations: readonly ReanchorAbObservation[]): ReanchorAbVerdict {
	const baselineMean =
		observations.length > 0
			? observations.reduce((sum, observation) => sum + observation.baseline.score, 0) / observations.length
			: 0;
	const anchoredMean =
		observations.length > 0
			? observations.reduce((sum, observation) => sum + observation.anchored.score, 0) / observations.length
			: 0;
	const regressedModels = observations
		.filter((observation) => observation.anchored.score < observation.baseline.score)
		.map((observation) => observation.modelId);
	const improvedModels = observations
		.filter((observation) => observation.anchored.score > observation.baseline.score)
		.map((observation) => observation.modelId);
	return {
		baselineMean,
		anchoredMean,
		regressedModels,
		improvedModels,
		decision: regressedModels.length > 0 ? "reject" : improvedModels.length > 0 ? "enable" : "inconclusive",
	};
}
