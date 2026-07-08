import { recallAtK } from "./retrieval-recall-eval.js";

/**
 * Internal LongMemEval-style fixture for deciding whether !Klein may broaden memory scope.
 *
 * This is deliberately model-agnostic: it measures whether a recall implementation can retrieve injected facts across
 * multiple prior sessions and abstain when the injected history does not contain the answer. A live model validation
 * layer still has to prove the benchmark discriminates real answer quality before runtime scope broadening is wired.
 */

export interface LongMemoryEvalMemory {
	id: string;
	namespace: string;
	sessionId: string;
	text: string;
	recordedAt: number;
}

export interface LongMemoryEvalPrompt {
	id: string;
	query: string;
	/** Empty means the correct behavior is abstain/no retrieval. */
	relevantMemoryIds: readonly string[];
}

export interface LongMemoryEvalCase {
	id: string;
	description: string;
	memories: readonly LongMemoryEvalMemory[];
	prompts: readonly LongMemoryEvalPrompt[];
}

export interface LongMemoryEvalPromptResult {
	caseId: string;
	promptId: string;
	query: string;
	relevantMemoryIds: readonly string[];
	retrievedIds: readonly string[];
	recallAtK: number;
	passed: boolean;
	failureReason: string | null;
}

export interface LongMemoryEvalReport {
	k: number;
	promptCount: number;
	answerablePromptCount: number;
	abstainPromptCount: number;
	recallAtK: number;
	abstainAccuracy: number;
	passed: boolean;
	results: readonly LongMemoryEvalPromptResult[];
}

export type LongMemoryEvalRanker = (input: {
	case_: LongMemoryEvalCase;
	prompt: LongMemoryEvalPrompt;
}) => readonly string[];

export interface LongMemoryEvalThresholds {
	minRecallAtK?: number;
	minAbstainAccuracy?: number;
}

export function buildInternalLongMemoryEvalFixture(): LongMemoryEvalCase[] {
	return [
		{
			id: "cross-session-project-memory",
			description: "Recall project facts injected across multiple historical sessions and abstain on missing facts.",
			memories: [
				{
					id: "alpha-api-base-url",
					namespace: "ws-alpha",
					sessionId: "alpha-session-1",
					text: "Project Alpha API base URL is http://localhost:4317/v2.",
					recordedAt: 1_000,
				},
				{
					id: "alpha-release-dry-run",
					namespace: "ws-alpha",
					sessionId: "alpha-session-2",
					text: "Project Alpha release checklist requires a migration dry-run before tagging.",
					recordedAt: 2_000,
				},
				{
					id: "beta-api-base-url",
					namespace: "ws-beta",
					sessionId: "beta-session-1",
					text: "Project Beta API base URL is http://localhost:9911/v1.",
					recordedAt: 1_500,
				},
			],
			prompts: [
				{
					id: "alpha-base-url",
					query: "What API base URL should Project Alpha use?",
					relevantMemoryIds: ["alpha-api-base-url"],
				},
				{
					id: "alpha-release-prerequisite",
					query: "What must happen before tagging a Project Alpha release?",
					relevantMemoryIds: ["alpha-release-dry-run"],
				},
				{
					id: "alpha-payment-provider",
					query: "Which payment provider did Project Alpha choose?",
					relevantMemoryIds: [],
				},
			],
		},
	];
}

export function evaluateLongMemoryBenchmark(
	cases: readonly LongMemoryEvalCase[],
	ranker: LongMemoryEvalRanker,
	options: { k?: number; thresholds?: LongMemoryEvalThresholds } = {},
): LongMemoryEvalReport {
	const k = Math.max(1, options.k ?? 3);
	const minRecallAtK = options.thresholds?.minRecallAtK ?? 1;
	const minAbstainAccuracy = options.thresholds?.minAbstainAccuracy ?? 1;
	const results: LongMemoryEvalPromptResult[] = [];
	for (const case_ of cases) {
		for (const prompt of case_.prompts) {
			const retrievedIds = [...ranker({ case_, prompt })].slice(0, k);
			const answerable = prompt.relevantMemoryIds.length > 0;
			const promptRecall = answerable ? recallAtK(retrievedIds, prompt.relevantMemoryIds, k) : 0;
			const abstained = !answerable && retrievedIds.length === 0;
			const passed = answerable ? promptRecall >= 1 : abstained;
			results.push({
				caseId: case_.id,
				promptId: prompt.id,
				query: prompt.query,
				relevantMemoryIds: [...prompt.relevantMemoryIds],
				retrievedIds,
				recallAtK: promptRecall,
				passed,
				failureReason: passed
					? null
					: answerable
						? `missed relevant memory within top-${k}`
						: "retrieved memory when the fixture required abstention",
			});
		}
	}
	const answerable = results.filter((result) => result.relevantMemoryIds.length > 0);
	const abstain = results.filter((result) => result.relevantMemoryIds.length === 0);
	const meanRecall =
		answerable.length === 0 ? 0 : answerable.reduce((sum, result) => sum + result.recallAtK, 0) / answerable.length;
	const abstainAccuracy = abstain.length === 0 ? 1 : abstain.filter((result) => result.passed).length / abstain.length;
	return {
		k,
		promptCount: results.length,
		answerablePromptCount: answerable.length,
		abstainPromptCount: abstain.length,
		recallAtK: meanRecall,
		abstainAccuracy,
		passed:
			results.length > 0 &&
			meanRecall >= minRecallAtK &&
			abstainAccuracy >= minAbstainAccuracy &&
			results.every((result) => result.passed),
		results,
	};
}

export interface MemoryScopeBroadeningDecision {
	accessAllOptIn: boolean;
	reason: string;
}

export function decideMemoryScopeBroadening(input: {
	requestedAccessAllOptIn: boolean;
	benchmark: LongMemoryEvalReport | null;
}): MemoryScopeBroadeningDecision {
	if (!input.requestedAccessAllOptIn) {
		return { accessAllOptIn: false, reason: "Scope broadening was not requested." };
	}
	if (!input.benchmark) {
		return { accessAllOptIn: false, reason: "Scope broadening requires a LongMemEval benchmark result." };
	}
	if (!input.benchmark.passed) {
		return { accessAllOptIn: false, reason: "LongMemEval benchmark did not pass." };
	}
	return { accessAllOptIn: true, reason: "LongMemEval benchmark passed." };
}
