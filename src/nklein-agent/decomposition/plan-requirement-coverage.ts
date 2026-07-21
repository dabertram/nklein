import { tokenizeForLexicalScore } from "../nklein-lexical-score";
import type { NKleinPlanTask } from "../nklein-plan-artifacts";

const REQUIREMENT_PREFIX = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/;
const STOP_WORDS = new Set([
	"about",
	"after",
	"also",
	"based",
	"between",
	"card",
	"cards",
	"create",
	"ensure",
	"feature",
	"from",
	"have",
	"implementation",
	"into",
	"must",
	"only",
	"project",
	"should",
	"that",
	"their",
	"them",
	"then",
	"this",
	"tool",
	"update",
	"using",
	"value",
	"when",
	"with",
]);
const EXACT_COVERAGE_TOKENS = new Set([
	"all",
	"deterministic",
	"every",
	"exactly",
	"idempotent",
	"never",
	"pure",
	"stable",
]);

export interface UncoveredPlanRequirement {
	requirement: string;
	missingExactTokens: string[];
	matchedTokenCount: number;
	requiredTokenCount: number;
}

function normalizeToken(token: string): string {
	const cleaned = token.replace(/^[._$-]+|[._$-]+$/g, "");
	if (cleaned.length > 4 && cleaned.endsWith("s") && !cleaned.endsWith("ss")) {
		return cleaned.slice(0, -1);
	}
	return cleaned;
}

function significantTokens(text: string): string[] {
	return [
		...new Set(
			tokenizeForLexicalScore(text)
				.map(normalizeToken)
				.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
		),
	];
}

function exactCoverageTokens(requirement: string, tokens: readonly string[]): string[] {
	const exact = new Set(tokens.filter((token) => EXACT_COVERAGE_TOKENS.has(token)));
	const alternatives = /\b(?:as|one of)\s+(.+)$/i.exec(requirement)?.[1];
	if (alternatives && /,|\bor\b/i.test(alternatives)) {
		for (const token of significantTokens(alternatives)) {
			exact.add(token);
		}
	}
	return [...exact];
}

export function extractPlanRequirementStatements(spec: string): string[] {
	return spec
		.split(/\r?\n/)
		.filter((line) => REQUIREMENT_PREFIX.test(line))
		.map((line) => line.replace(REQUIREMENT_PREFIX, "").trim())
		.filter((line) => line.length > 0);
}

function taskContractText(task: NKleinPlanTask): string {
	return [
		task.id,
		task.title,
		task.prompt,
		task.acceptanceCommand,
		task.acceptanceTestPrompt,
		task.knowledgeDebt,
		...(task.filesLikelyTouched ?? []),
		...(task.writeScope ?? []),
		...(task.preconditions ?? []),
		...(task.inputs ?? []),
		...(task.expectedOutputs ?? []),
		...(task.acceptanceChecks ?? []),
		...(task.nonGoals ?? []),
		...(task.dependencyOutputsConsumed ?? []),
		...(task.interfaces ?? []),
	]
		.filter((value): value is string => typeof value === "string" && value.length > 0)
		.join("\n");
}

/**
 * Cheap fail-closed coverage check before an expensive model critic. It does not decide whether code already satisfies
 * a requirement; it only requires the candidate graph to name the requirement in an implementation, verification, or
 * acceptance contract. Existing behavior may therefore be represented by a focused regression-test card instead of a
 * redundant implementation card.
 */
export function findUncoveredPlanRequirements(
	spec: string,
	tasks: readonly NKleinPlanTask[],
): UncoveredPlanRequirement[] {
	const contractTokens = new Set(significantTokens(tasks.map(taskContractText).join("\n")));
	const uncovered: UncoveredPlanRequirement[] = [];
	for (const requirement of extractPlanRequirementStatements(spec)) {
		const tokens = significantTokens(requirement);
		if (tokens.length === 0) continue;
		const matchedTokenCount = tokens.filter((token) => contractTokens.has(token)).length;
		const requiredTokenCount = tokens.length <= 2 ? 1 : Math.max(2, Math.ceil(tokens.length * 0.25));
		const missingExactTokens = exactCoverageTokens(requirement, tokens).filter((token) => !contractTokens.has(token));
		if (matchedTokenCount < requiredTokenCount || missingExactTokens.length > 0) {
			uncovered.push({ requirement, missingExactTokens, matchedTokenCount, requiredTokenCount });
		}
	}
	return uncovered;
}

export function formatUncoveredPlanRequirements(uncovered: readonly UncoveredPlanRequirement[]): string {
	return uncovered
		.map((item) => {
			const exact =
				item.missingExactTokens.length > 0
					? ` Missing exact invariant term(s): ${item.missingExactTokens.join(", ")}.`
					: "";
			return `- ${item.requirement} (contract coverage ${item.matchedTokenCount}/${item.requiredTokenCount} required anchors).${exact}`;
		})
		.join("\n");
}
