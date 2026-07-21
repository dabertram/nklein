/**
 * F4.11 paired quality proof for the learned context-budget wire.
 *
 * The control is a still-sendable transcript near the learned window's overflow threshold. The treatment is the
 * byte-for-byte output of the production `planContextBudget` compaction path for the same history and final request.
 * Authoritative facts live in the first user message (which production preserves); superseded decoys live in old bulk
 * assistant text. This tests the causal question we care about: does shedding stale bulk improve or retain contract
 * recall, without pretending that an independently-built short prompt exercises the live policy?
 */

import { emptyModelBehaviorProfile, learnedQualityEffectiveBudget } from "../core/model-behavior-profile";
import { type ContextBudgetPlan, planContextBudget } from "./nklein-context-budget-plan";
import { buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
import { countKanbanPersistedMessagesTokens } from "./nklein-context-focus-policy";
import type { NKleinSdkPersistedMessage } from "./sdk-runtime-boundary";

export type LearnedBudgetQualityArm = "overflow_threshold" | "learned_compacted";
export type LearnedBudgetModelTier = "small" | "capable";

export interface LearnedBudgetQualityCase {
	id: string;
	history: NKleinSdkPersistedMessage[];
	prompt: string;
	expectedValues: readonly string[];
	supersededValues: readonly string[];
}

export interface LearnedBudgetQualityScore {
	score: number;
	passed: boolean;
	matchedValues: string[];
	missingValues: string[];
	leakedSupersededValues: string[];
}

export interface LearnedBudgetQualityPair {
	caseId: string;
	learnedBudgetTokens: number;
	plan: ContextBudgetPlan;
	overflowThresholdMessages: NKleinSdkPersistedMessage[];
	learnedCompactedMessages: NKleinSdkPersistedMessage[];
}

export interface LearnedBudgetQualityObservation {
	modelId: string;
	modelTier: LearnedBudgetModelTier;
	caseId: string;
	overflowThreshold: LearnedBudgetQualityScore;
	learnedCompacted: LearnedBudgetQualityScore;
}

export interface LearnedBudgetQualityVerdict {
	decision: "pass" | "fail" | "inconclusive";
	smallModels: number;
	capableModels: number;
	scorableCapablePairs: number;
	smallRegressions: number;
	capableRegressions: number;
	compactedFailures: number;
}

const LEARNED_FLOOR_TOKENS = 32_000;
const FIRST_DEGRADED_AT_TOKENS = 35_555;

function repeatToLength(sentence: string, targetChars: number): string {
	const repetitions = Math.max(1, Math.ceil(targetChars / sentence.length));
	return sentence.repeat(repetitions).slice(0, targetChars);
}

function buildSupersededBulk(caseId: string, supersededValues: readonly string[], targetChars: number): string {
	const preface = repeatToLength(
		`Archived ${caseId} telemetry sample. This material is historical scratch work and not an authoritative contract. `,
		8_000,
	);
	const stale = `\nSUPERSEDED DRAFT VALUES — IGNORE: ${supersededValues.join(" | ")}\n`;
	return `${preface}${repeatToLength(stale, Math.max(1, targetChars - preface.length))}`;
}

function buildNeutralBulk(caseId: string, targetChars: number): string {
	return repeatToLength(
		`Historical ${caseId} diagnostic record: worker latency was nominal, queue depth was ordinary, and no current contract field was recorded in this sample. `,
		targetChars,
	);
}

function buildHistory(input: {
	caseId: string;
	authoritativeContract: string;
	supersededValues: readonly string[];
}): NKleinSdkPersistedMessage[] {
	return [
		{
			role: "user",
			content: [
				"AUTHORITATIVE CONTRACT — preserve these exact opaque values even if later scratch text disagrees.",
				input.authoritativeContract,
			].join("\n"),
		},
		{
			role: "assistant",
			content: buildSupersededBulk(input.caseId, input.supersededValues, 48_000),
		},
		{
			role: "user",
			content: "Continue reviewing the historical diagnostics; the opening contract remains authoritative.",
		},
		{
			role: "assistant",
			content: buildNeutralBulk(input.caseId, 72_000),
		},
		{ role: "user", content: "Now return to the authoritative contract from the opening message." },
		{ role: "assistant", content: "Ready to answer from the authoritative opening contract." },
	];
}

export function buildLearnedBudgetQualityCases(): LearnedBudgetQualityCase[] {
	const firstExpected = ["ORBIT-CEDAR", "PATCH-EMBER", "LOCAL-ONLY", "CLOCKWISE-7"] as const;
	const firstSuperseded = ["TIDAL-IVORY", "SCAN-AZURE", "CLOUD-OK", "COUNTER-19"] as const;
	const secondExpected = ["NORTHSTAR-42", "src/helix.ts", "npm run verify:helix", "NEVER-WIDEN"] as const;
	const secondSuperseded = ["SOUTHPORT-11", "src/legacy.ts", "npm test", "WIDEN-ALLOWED"] as const;
	return [
		{
			id: "delivery-contract",
			history: buildHistory({
				caseId: "delivery-contract",
				authoritativeContract: [
					`OBJECTIVE: ${firstExpected[0]}`,
					`CURRENT FOCUS: ${firstExpected[1]}`,
					`CONSTRAINT: ${firstExpected[2]}`,
					`ACCEPTANCE CRITERIA: ${firstExpected[3]}`,
				].join("\n"),
				supersededValues: firstSuperseded,
			}),
			prompt:
				"Return ONLY one compact JSON object with keys objective, current_focus, constraint, acceptance. Use the exact authoritative opaque values; do not include historical or superseded values.",
			expectedValues: firstExpected,
			supersededValues: firstSuperseded,
		},
		{
			id: "implementation-contract",
			history: buildHistory({
				caseId: "implementation-contract",
				authoritativeContract: [
					`ROUTE: ${secondExpected[0]}`,
					`FILE: ${secondExpected[1]}`,
					`VERIFY COMMAND: ${secondExpected[2]}`,
					`INVARIANT: ${secondExpected[3]}`,
				].join("\n"),
				supersededValues: secondSuperseded,
			}),
			prompt:
				"Return ONLY one compact JSON object with keys route, file, verify_command, invariant. Use the exact authoritative values; do not include historical or superseded values.",
			expectedValues: secondExpected,
			supersededValues: secondSuperseded,
		},
	];
}

export function buildLearnedBudgetQualityPair(
	case_: LearnedBudgetQualityCase,
	options: { advertisedWindowTokens?: number; firstDegradedAtTokens?: number } = {},
): LearnedBudgetQualityPair {
	const profile = {
		...emptyModelBehaviorProfile("f4.11-quality-probe"),
		qualityDegradedAtTokens: options.firstDegradedAtTokens ?? FIRST_DEGRADED_AT_TOKENS,
	};
	const learnedBudgetTokens = learnedQualityEffectiveBudget(profile, { floorTokens: LEARNED_FLOOR_TOKENS });
	if (learnedBudgetTokens === null) throw new Error("F4.11 fixture must produce a learned quality budget.");
	const effectiveWindow = Math.min(options.advertisedWindowTokens ?? 64_000, learnedBudgetTokens);
	const plan = planContextBudget({ messages: case_.history, prompt: case_.prompt, contextWindow: effectiveWindow });
	const safety = buildKanbanContextSafetyBudgets(effectiveWindow);
	if (plan.outcome !== "compacted") {
		throw new Error(`F4.11 fixture must exercise production compaction; received ${plan.outcome}.`);
	}
	if (plan.originalProjectedTokens > effectiveWindow) {
		throw new Error("F4.11 raw control must remain sendable rather than testing provider overflow rejection.");
	}
	if (plan.originalHistoryTokens <= (safety.safeWorkingBudget ?? effectiveWindow)) {
		throw new Error("F4.11 raw control must sit beyond the learned window's safe working threshold.");
	}
	const finalMessage: NKleinSdkPersistedMessage = { role: "user", content: case_.prompt };
	return {
		caseId: case_.id,
		learnedBudgetTokens: effectiveWindow,
		plan,
		overflowThresholdMessages: [...case_.history, finalMessage],
		learnedCompactedMessages: [...plan.compactedMessages, finalMessage],
	};
}

function normalize(value: string): string {
	return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

export function scoreLearnedBudgetQualityAnswer(
	answer: string,
	case_: Pick<LearnedBudgetQualityCase, "expectedValues" | "supersededValues">,
): LearnedBudgetQualityScore {
	const normalized = normalize(answer);
	const matchedValues = case_.expectedValues.filter((value) => normalized.includes(normalize(value)));
	const missingValues = case_.expectedValues.filter((value) => !normalized.includes(normalize(value)));
	const leakedSupersededValues = case_.supersededValues.filter((value) => normalized.includes(normalize(value)));
	return {
		score: case_.expectedValues.length === 0 ? 0 : matchedValues.length / case_.expectedValues.length,
		passed: missingValues.length === 0 && leakedSupersededValues.length === 0,
		matchedValues: [...matchedValues],
		missingValues: [...missingValues],
		leakedSupersededValues: [...leakedSupersededValues],
	};
}

export function summarizeLearnedBudgetQualityAb(
	observations: readonly LearnedBudgetQualityObservation[],
): LearnedBudgetQualityVerdict {
	const smallModelIds = new Set(observations.filter((row) => row.modelTier === "small").map((row) => row.modelId));
	const capableModelIds = new Set(observations.filter((row) => row.modelTier === "capable").map((row) => row.modelId));
	const regressions = observations.filter((row) => row.overflowThreshold.passed && !row.learnedCompacted.passed);
	const smallRegressions = regressions.filter((row) => row.modelTier === "small").length;
	const capableRegressions = regressions.filter((row) => row.modelTier === "capable").length;
	const compactedFailures = observations.filter((row) => !row.learnedCompacted.passed).length;
	const scorableCapablePairs = observations.filter(
		(row) => row.modelTier === "capable" && row.overflowThreshold.passed,
	).length;
	const hasCoverage = smallModelIds.size > 0 && capableModelIds.size > 0 && scorableCapablePairs > 0;
	return {
		decision: !hasCoverage ? "inconclusive" : regressions.length === 0 && compactedFailures === 0 ? "pass" : "fail",
		smallModels: smallModelIds.size,
		capableModels: capableModelIds.size,
		scorableCapablePairs,
		smallRegressions,
		capableRegressions,
		compactedFailures,
	};
}

export function countLearnedBudgetArmTokens(messages: readonly NKleinSdkPersistedMessage[]): number {
	return countKanbanPersistedMessagesTokens(messages);
}
