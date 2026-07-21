import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
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
	/** Needles used by the live model-backed validation harness to score grounded answers deterministically. */
	expectedAnswerMustInclude?: readonly string[];
	/**
	 * F2.10: memory ids that must NOT be retrieved for this prompt — retrieving any is a hard failure. This is
	 * how the CONTRADICTION (the superseded/conflicting memory), PRIVACY (another namespace's memory), and
	 * RECENCY (the stale version) dimensions are measured: each names its forbidden set explicitly.
	 */
	forbiddenMemoryIds?: readonly string[];
	/** Which quality dimension this prompt measures. Default `relevance` (abstain prompts count there too). */
	dimension?: LongMemoryEvalDimension;
}

export const LONG_MEMORY_EVAL_DIMENSIONS = ["relevance", "contradiction", "privacy", "recency"] as const;
export type LongMemoryEvalDimension = (typeof LONG_MEMORY_EVAL_DIMENSIONS)[number];

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
	/** F2.10: forbidden memories that WERE retrieved (contradiction/privacy/recency violations). */
	retrievedForbiddenIds: readonly string[];
	dimension: LongMemoryEvalDimension;
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
	/** F2.10: pass-rate per measured dimension (1 for dimensions with no prompts). */
	dimensionPassRate: Record<LongMemoryEvalDimension, number>;
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
					expectedAnswerMustInclude: ["http://localhost:4317/v2"],
				},
				{
					id: "alpha-release-prerequisite",
					query: "What must happen before tagging a Project Alpha release?",
					relevantMemoryIds: ["alpha-release-dry-run"],
					expectedAnswerMustInclude: ["migration dry-run"],
				},
				{
					id: "alpha-payment-provider",
					query: "Which payment provider did Project Alpha choose?",
					relevantMemoryIds: [],
				},
			],
		},
		{
			id: "contradiction-recency-privacy",
			description:
				"F2.10: a superseded decision must yield the NEWER memory (recency), a conflicting note must not co-retrieve (contradiction), and another workspace's memory must never leak (privacy).",
			memories: [
				{
					id: "gamma-db-old",
					namespace: "ws-gamma",
					sessionId: "gamma-session-1",
					text: "Project Gamma uses SQLite for persistence.",
					recordedAt: 1_000,
				},
				{
					id: "gamma-db-new",
					namespace: "ws-gamma",
					sessionId: "gamma-session-3",
					text: "Decision update: Project Gamma migrated persistence from SQLite to Postgres.",
					recordedAt: 5_000,
				},
				{
					id: "gamma-retry-policy",
					namespace: "ws-gamma",
					sessionId: "gamma-session-2",
					text: "Project Gamma retries failed jobs three times with exponential backoff.",
					recordedAt: 2_000,
				},
				{
					id: "delta-secret-endpoint",
					namespace: "ws-delta",
					sessionId: "delta-session-1",
					text: "Project Delta database endpoint is postgres://delta-internal:5432.",
					recordedAt: 3_000,
				},
			],
			prompts: [
				{
					id: "gamma-db-current",
					query: "What database does Project Gamma use for persistence?",
					relevantMemoryIds: ["gamma-db-new"],
					forbiddenMemoryIds: ["gamma-db-old"],
					dimension: "recency",
					expectedAnswerMustInclude: ["Postgres"],
				},
				{
					id: "gamma-retry",
					query: "How does Project Gamma handle failed jobs?",
					relevantMemoryIds: ["gamma-retry-policy"],
					forbiddenMemoryIds: ["gamma-db-old"],
					dimension: "contradiction",
					expectedAnswerMustInclude: ["three times"],
				},
				{
					id: "gamma-db-endpoint-privacy",
					query: "What is the Gamma workspace's database endpoint?",
					relevantMemoryIds: [],
					forbiddenMemoryIds: ["delta-secret-endpoint"],
					dimension: "privacy",
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
			const forbidden = new Set(prompt.forbiddenMemoryIds ?? []);
			const retrievedForbiddenIds = retrievedIds.filter((id) => forbidden.has(id));
			const passed = retrievedForbiddenIds.length === 0 && (answerable ? promptRecall >= 1 : abstained);
			results.push({
				caseId: case_.id,
				promptId: prompt.id,
				query: prompt.query,
				relevantMemoryIds: [...prompt.relevantMemoryIds],
				retrievedIds,
				recallAtK: promptRecall,
				retrievedForbiddenIds,
				dimension: prompt.dimension ?? "relevance",
				passed,
				failureReason: passed
					? null
					: retrievedForbiddenIds.length > 0
						? `retrieved forbidden memory (${retrievedForbiddenIds.join(", ")}) — a ${prompt.dimension ?? "relevance"} violation`
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
	const dimensionPassRate = Object.fromEntries(
		LONG_MEMORY_EVAL_DIMENSIONS.map((dimension) => {
			const inDimension = results.filter((result) => result.dimension === dimension);
			return [
				dimension,
				inDimension.length === 0 ? 1 : inDimension.filter((result) => result.passed).length / inDimension.length,
			];
		}),
	) as Record<LongMemoryEvalDimension, number>;
	return {
		k,
		promptCount: results.length,
		answerablePromptCount: answerable.length,
		abstainPromptCount: abstain.length,
		recallAtK: meanRecall,
		abstainAccuracy,
		dimensionPassRate,
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
	benchmark: Pick<LongMemoryEvalReport, "passed"> | LongMemoryEvalRetainedVerdict | null;
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

// ── F2.10b retained per-model/store verdict ───────────────────────────────────────────────────────────────────────

export const LONG_MEMORY_EVAL_DECISION = "long_memory_eval";
export const LONG_MEMORY_EVAL_WORKFLOW_ID = "long-memory-eval";
/** Bump whenever the production recall composition/ranking semantics change; old evidence must then fail closed. */
export const LONG_MEMORY_RECALL_STACK_VERSION = "unified-chat-memory-v2";
/** Re-run cheap live memory evidence weekly so a changed local runtime/model cannot inherit an old pass indefinitely. */
const LONG_MEMORY_EVAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

/** The exact recall implementation paired with a reader model in retained evidence. */
export function buildLongMemoryStoreProfile(embeddingModelId: string | null): string {
	return `${LONG_MEMORY_RECALL_STACK_VERSION}:${embeddingModelId?.trim() || "lexical"}`;
}

export interface LongMemoryEvalRetainedVerdict {
	modelId: string;
	storeProfile: string;
	passed: boolean;
	retrievalPassed: boolean;
	answersPassed: boolean;
	controlsDiscriminate: boolean;
	recallAtK: number;
	abstainAccuracy: number;
	dimensionPassRate: Record<LongMemoryEvalDimension, number>;
	evaluatedAt: number;
}

export function isLongMemoryEvalVerdictFresh(
	verdict: Pick<LongMemoryEvalRetainedVerdict, "evaluatedAt">,
	now = Date.now(),
	maxAgeMs = LONG_MEMORY_EVAL_MAX_AGE_MS,
): boolean {
	return (
		Number.isFinite(verdict.evaluatedAt) &&
		verdict.evaluatedAt <= now &&
		now - verdict.evaluatedAt <= Math.max(0, maxAgeMs)
	);
}

export function buildLongMemoryEvalRetainedVerdict(input: {
	modelId: string;
	storeProfile: string;
	report: LongMemoryEvalReport;
	answersPassed: boolean;
	controlsDiscriminate: boolean;
	evaluatedAt: number;
}): LongMemoryEvalRetainedVerdict {
	const retrievalPassed = input.report.passed;
	return {
		modelId: input.modelId,
		storeProfile: input.storeProfile,
		passed: retrievalPassed && input.answersPassed && input.controlsDiscriminate,
		retrievalPassed,
		answersPassed: input.answersPassed,
		controlsDiscriminate: input.controlsDiscriminate,
		recallAtK: input.report.recallAtK,
		abstainAccuracy: input.report.abstainAccuracy,
		dimensionPassRate: { ...input.report.dimensionPassRate },
		evaluatedAt: input.evaluatedAt,
	};
}

function longMemoryEvalTaskId(modelId: string, storeProfile: string): string {
	return `long-memory-eval:${encodeURIComponent(modelId)}:${encodeURIComponent(storeProfile)}`;
}

/** Retain one live run in the agent ledger; the exact model/store pair is embedded and latest-wins on read. */
export function buildLongMemoryEvalRetentionEvent(input: {
	workspacePathHash: string;
	verdict: LongMemoryEvalRetainedVerdict;
}): AgentTransitionEvent {
	return buildTransitionEvent({
		workflowId: LONG_MEMORY_EVAL_WORKFLOW_ID,
		taskId: longMemoryEvalTaskId(input.verdict.modelId, input.verdict.storeProfile),
		workspacePathHash: input.workspacePathHash,
		from: "memory_eval",
		to: input.verdict.passed ? "long_memory_eval_pass" : "long_memory_eval_fail",
		reason: JSON.stringify(input.verdict).slice(0, 900),
		controllerDecision: LONG_MEMORY_EVAL_DECISION,
		recordedAt: input.verdict.evaluatedAt,
	});
}

function parseRetainedVerdict(reason: string | null): LongMemoryEvalRetainedVerdict | null {
	if (!reason) return null;
	try {
		const value = JSON.parse(reason) as Partial<LongMemoryEvalRetainedVerdict>;
		if (
			typeof value.modelId !== "string" ||
			typeof value.storeProfile !== "string" ||
			typeof value.passed !== "boolean" ||
			typeof value.retrievalPassed !== "boolean" ||
			typeof value.answersPassed !== "boolean" ||
			typeof value.controlsDiscriminate !== "boolean" ||
			typeof value.recallAtK !== "number" ||
			typeof value.abstainAccuracy !== "number" ||
			typeof value.evaluatedAt !== "number" ||
			!value.dimensionPassRate
		) {
			return null;
		}
		const dimensionPassRate = {} as Record<LongMemoryEvalDimension, number>;
		for (const dimension of LONG_MEMORY_EVAL_DIMENSIONS) {
			const rate = value.dimensionPassRate[dimension];
			if (typeof rate !== "number" || !Number.isFinite(rate)) return null;
			dimensionPassRate[dimension] = rate;
		}
		return {
			modelId: value.modelId,
			storeProfile: value.storeProfile,
			passed: value.passed,
			retrievalPassed: value.retrievalPassed,
			answersPassed: value.answersPassed,
			controlsDiscriminate: value.controlsDiscriminate,
			recallAtK: value.recallAtK,
			abstainAccuracy: value.abstainAccuracy,
			dimensionPassRate,
			evaluatedAt: value.evaluatedAt,
		};
	} catch {
		return null;
	}
}

/** Read the latest valid verdict for exactly this reader-model + recall-store implementation pair. */
export function readLongMemoryEvalRetainedVerdict(
	events: readonly AgentLedgerEvent[],
	modelId: string,
	storeProfile: string,
): LongMemoryEvalRetainedVerdict | null {
	let latest: LongMemoryEvalRetainedVerdict | null = null;
	for (const event of events) {
		if (event.kind !== "transition" || event.controllerDecision !== LONG_MEMORY_EVAL_DECISION) continue;
		const verdict = parseRetainedVerdict(event.reason);
		if (!verdict || verdict.modelId !== modelId || verdict.storeProfile !== storeProfile) continue;
		if (!latest || verdict.evaluatedAt >= latest.evaluatedAt) latest = verdict;
	}
	return latest;
}
