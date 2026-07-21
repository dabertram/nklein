/**
 * F4.6 paired answer-quality evaluation for the live retrieval synthesis prompt.
 *
 * Each case is sent twice to the SAME model: once with the full evidence control and once through production's
 * extraction path. A deterministic scorer checks both the expected facts and stable evidence ids. This does not ask
 * one model to judge another model's prose, and it does not let token saving stand in for answer quality.
 */

import { estimateTextTokens } from "./eval-context-footprint";
import type { RetrievalEvidence } from "./retrieval-loop-driver";
import {
	buildSynthesisPrompt,
	buildUntrimmedSynthesisPrompt,
	parseSynthesisClaims,
} from "./retrieval-synthesis-adapter";

export interface SynthesisEvidenceQualityCase {
	readonly id: string;
	readonly task: string;
	readonly evidence: readonly RetrievalEvidence[];
	readonly expectedNeedles: readonly string[];
	readonly expectedCitationIds: readonly string[];
}

export interface SynthesisEvidenceQualityScore {
	readonly passed: boolean;
	readonly factRecall: number;
	readonly citationRecall: number;
	readonly score: number;
	readonly missingNeedles: readonly string[];
	readonly missingCitationIds: readonly string[];
}

export interface SynthesisEvidenceQualityPair {
	readonly caseId: string;
	readonly tokensBefore: number;
	readonly tokensAfter: number;
	readonly full: SynthesisEvidenceQualityScore;
	readonly trimmed: SynthesisEvidenceQualityScore;
	readonly regressed: boolean;
}

export interface SynthesisEvidenceQualityReport {
	readonly pairs: readonly SynthesisEvidenceQualityPair[];
	readonly passed: boolean;
	readonly scorablePairs: number;
	readonly regressions: number;
	readonly fullMean: number;
	readonly trimmedMean: number;
	readonly tokenSavingFraction: number;
	/** Standalone model quality is diagnostic; paired regression is the F4.6 extraction verdict. */
	readonly fullPassRate: number;
	readonly trimmedPassRate: number;
}

export type SynthesisEvidenceQualityComplete = (input: {
	caseId: string;
	variant: "full" | "trimmed";
	prompt: string;
}) => Promise<string>;

function normalize(value: string): string {
	return value.toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

/** Score facts and citation addressability independently, then require both for a pass. */
export function scoreSynthesisEvidenceAnswer(
	raw: string,
	case_: Pick<SynthesisEvidenceQualityCase, "expectedNeedles" | "expectedCitationIds">,
): SynthesisEvidenceQualityScore {
	const knownIds = new Set(case_.expectedCitationIds);
	const claims = parseSynthesisClaims(raw, knownIds);
	const answerText = normalize(claims.length > 0 ? claims.map((claim) => claim.text).join(" ") : raw);
	const cited = new Set(claims.flatMap((claim) => claim.citedEvidenceIds));
	const missingNeedles = case_.expectedNeedles.filter((needle) => !answerText.includes(normalize(needle)));
	const missingCitationIds = case_.expectedCitationIds.filter((id) => !cited.has(id));
	const factRecall =
		case_.expectedNeedles.length === 0
			? 1
			: (case_.expectedNeedles.length - missingNeedles.length) / case_.expectedNeedles.length;
	const citationRecall =
		case_.expectedCitationIds.length === 0
			? 1
			: (case_.expectedCitationIds.length - missingCitationIds.length) / case_.expectedCitationIds.length;
	return {
		passed: missingNeedles.length === 0 && missingCitationIds.length === 0,
		factRecall,
		citationRecall,
		score: (factRecall + citationRecall) / 2,
		missingNeedles,
		missingCitationIds,
	};
}

/** Run paired controls sequentially per case so model contention cannot bias one variant. */
export async function runSynthesisEvidenceQualityEval(
	cases: readonly SynthesisEvidenceQualityCase[],
	complete: SynthesisEvidenceQualityComplete,
): Promise<SynthesisEvidenceQualityReport> {
	const pairs: SynthesisEvidenceQualityPair[] = [];
	for (const [index, case_] of cases.entries()) {
		const fullPrompt = buildUntrimmedSynthesisPrompt(case_.task, case_.evidence);
		const trimmedPrompt = buildSynthesisPrompt(case_.task, case_.evidence);
		// Alternate order so warm-up/cache effects do not systematically favor one side of the pair.
		const firstVariant = index % 2 === 0 ? "full" : "trimmed";
		const firstRaw = await complete({
			caseId: case_.id,
			variant: firstVariant,
			prompt: firstVariant === "full" ? fullPrompt : trimmedPrompt,
		});
		const secondVariant = firstVariant === "full" ? "trimmed" : "full";
		const secondRaw = await complete({
			caseId: case_.id,
			variant: secondVariant,
			prompt: secondVariant === "full" ? fullPrompt : trimmedPrompt,
		});
		const fullRaw = firstVariant === "full" ? firstRaw : secondRaw;
		const trimmedRaw = firstVariant === "trimmed" ? firstRaw : secondRaw;
		const full = scoreSynthesisEvidenceAnswer(fullRaw, case_);
		const trimmed = scoreSynthesisEvidenceAnswer(trimmedRaw, case_);
		pairs.push({
			caseId: case_.id,
			tokensBefore: estimateTextTokens(fullPrompt),
			tokensAfter: estimateTextTokens(trimmedPrompt),
			full,
			trimmed,
			regressed: full.passed && !trimmed.passed,
		});
	}
	const scorable = pairs.filter((pair) => pair.full.passed);
	const fullMean = pairs.length === 0 ? 0 : pairs.reduce((sum, pair) => sum + pair.full.score, 0) / pairs.length;
	const trimmedMean = pairs.length === 0 ? 0 : pairs.reduce((sum, pair) => sum + pair.trimmed.score, 0) / pairs.length;
	const tokensBefore = pairs.reduce((sum, pair) => sum + pair.tokensBefore, 0);
	const tokensAfter = pairs.reduce((sum, pair) => sum + pair.tokensAfter, 0);
	const regressions = pairs.filter((pair) => pair.regressed).length;
	return {
		pairs,
		// A model can be poor at synthesis independent of extraction. F4.6 asks the paired causal question: whenever the
		// full control answered, did trimming retain it? Keep standalone pass rates beside that verdict so incapacity is
		// visible rather than silently counted as extraction harm or success.
		passed: scorable.length > 0 && regressions === 0,
		scorablePairs: scorable.length,
		regressions,
		fullMean,
		trimmedMean,
		tokenSavingFraction: tokensBefore === 0 ? 0 : (tokensBefore - tokensAfter) / tokensBefore,
		fullPassRate: pairs.length === 0 ? 0 : scorable.length / pairs.length,
		trimmedPassRate: pairs.length === 0 ? 0 : pairs.filter((pair) => pair.trimmed.passed).length / pairs.length,
	};
}

const PADDING_A = "Release-history material about obsolete preview builds and unrelated migration notes. ".repeat(45);
const PADDING_B = "Operational background covering dashboards, ownership, and routine maintenance. ".repeat(45);

/** Small deterministic corpus: late-document facts, two-source synthesis, and distractor resistance. */
export function buildSynthesisEvidenceQualityCases(): readonly SynthesisEvidenceQualityCase[] {
	return [
		{
			id: "late-release-fact",
			task: "What retry limit does the Aster upload service use?",
			evidence: [
				{
					id: "e1",
					url: "https://docs.example.test/aster",
					text: `${PADDING_A}\nAster upload service retry limit: exactly seven attempts.\n${PADDING_B}`,
				},
			],
			expectedNeedles: ["seven attempts"],
			expectedCitationIds: ["e1"],
		},
		{
			id: "two-source-configuration",
			task: "Which port and timeout are configured for the Borealis gateway?",
			evidence: [
				{
					id: "e1",
					url: "https://docs.example.test/borealis/network",
					text: `${PADDING_B}\nBorealis gateway port: 8443.\n${PADDING_A}`,
				},
				{
					id: "e2",
					url: "https://docs.example.test/borealis/timeouts",
					text: `${PADDING_A}\nBorealis gateway timeout: 47 seconds.\n${PADDING_B}`,
				},
			],
			expectedNeedles: ["8443", "47 seconds"],
			expectedCitationIds: ["e1", "e2"],
		},
		{
			id: "distractor-value",
			task: "What cache size is required by the Cirrus indexer?",
			evidence: [
				{
					id: "e1",
					url: "https://docs.example.test/cirrus",
					text: `${PADDING_A}\nCirrus indexer required cache size: 384 MiB.\n${PADDING_B}`,
				},
				{
					id: "e2",
					url: "https://archive.example.test/other-product",
					text: `${PADDING_B}\nAn unrelated retired component once used 16 MiB.\n${PADDING_A}`,
				},
			],
			expectedNeedles: ["384 mib"],
			expectedCitationIds: ["e1"],
		},
	];
}
