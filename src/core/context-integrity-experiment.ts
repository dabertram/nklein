import { COMPACTION_FORMATS, type CompactionFact, type CompactionFormat, renderAllArms } from "./compaction-format.js";
import { assessPreRegistration } from "./minimum-detectable-effect.js";

export const CONTEXT_INTEGRITY_TASK_COUNT = 20;
export const CONTEXT_INTEGRITY_CONTEXT_WINDOW = 32_768;
export const CONTEXT_INTEGRITY_MDE_POINTS = 25;
export const CONTEXT_UTILISATION_LEVELS = [0.5, 0.75, 0.9] as const;

export type ContextIntegrityArm = `raw_${50 | 75 | 90}` | CompactionFormat;

export interface ContextIntegrityCase {
	readonly id: string;
	readonly facts: readonly CompactionFact[];
	readonly question: string;
	readonly expectedFragments: readonly string[];
}

export interface ContextIntegrityPrompt {
	readonly caseId: string;
	readonly arm: ContextIntegrityArm;
	readonly content: string;
	readonly requestedUtilisation: number | null;
}

export interface ContextIntegrityObservation {
	readonly caseId: string;
	readonly arm: ContextIntegrityArm;
	readonly score: number;
	readonly latencyMs: number;
	readonly promptTokens: number | null;
	readonly infraError: string | null;
}

const PROJECTS = [
	"atlas",
	"beacon",
	"cinder",
	"delta",
	"ember",
	"fjord",
	"garnet",
	"harbor",
	"indigo",
	"juniper",
	"kepler",
	"lumen",
	"mesa",
	"nylon",
	"onyx",
	"prairie",
	"quartz",
	"raven",
	"solace",
	"tundra",
] as const;
const COMMANDS = ["npm test", "pnpm test", "npm run check", "pnpm vitest run", "npm run test:fast"] as const;

function code(index: number, salt: number): string {
	return `${String.fromCharCode(65 + ((index * 7 + salt) % 26))}${(1_003 + index * 137 + salt * 29)
		.toString(36)
		.toUpperCase()}`;
}

export function buildContextIntegrityCases(): readonly ContextIntegrityCase[] {
	return PROJECTS.map((project, index) => {
		const errorCode = `E_${project.toUpperCase()}_${code(index, 3)}`;
		const file = `src/${project}/contract-${(index % 5) + 1}.ts`;
		const command = COMMANDS[index % COMMANDS.length] as string;
		const targetFacts: CompactionFact[] = [
			{ id: `${project}-file`, text: `The active implementation file for ${project} is ${file}` },
			{ id: `${project}-error`, text: `${project} must return error code ${errorCode} when validation fails` },
			{ id: `${project}-acceptance`, text: `The acceptance command for ${project} is ${command}` },
		];
		const background: CompactionFact[] = Array.from({ length: 57 }, (_, factIndex) => ({
			id: `${project}-background-${factIndex + 1}`,
			text:
				`Repository note ${factIndex + 1} for ${project}: module ${code(index + factIndex, 11)} ` +
				`owns checkpoint ${code(factIndex, index + 17)} and preserves deterministic retry order ${(factIndex % 7) + 1}`,
		}));
		const insertion = (index * 13) % (background.length + 1);
		const facts = [...background.slice(0, insertion), ...targetFacts, ...background.slice(insertion)];
		return {
			id: `context-integrity-${project}`,
			facts,
			question: `For project ${project}, answer with exactly three pipe-separated values: active implementation file | validation error code | acceptance command.`,
			expectedFragments: [file, errorCode, command],
		};
	});
}

function fillerParagraph(caseIndex: number, paragraph: number): string {
	const prior = PROJECTS[(caseIndex + paragraph + 1) % PROJECTS.length] as string;
	return (
		`Historical attempt ${paragraph + 1}: the ${prior} worker inspected adapter ${code(caseIndex, paragraph)}. ` +
		`That superseded attempt discussed file src/${prior}/legacy-${paragraph % 9}.ts, error E_${prior.toUpperCase()}_${code(paragraph, 23)}, ` +
		`and command npm run legacy:${paragraph % 11}. These are unrelated historical details and are not the active ${PROJECTS[caseIndex]} contract.\n`
	);
}

function rawContext(case_: ContextIntegrityCase, utilisation: number, contextWindow: number): string {
	const caseIndex = PROJECTS.indexOf(case_.id.replace("context-integrity-", "") as (typeof PROJECTS)[number]);
	const targetChars = Math.floor(contextWindow * utilisation * 4);
	const facts = renderAllArms(case_.facts, caseIndex + 1).narrative.text;
	let filler = "";
	let paragraph = 0;
	while (filler.length + facts.length < targetChars) {
		filler += fillerParagraph(caseIndex, paragraph);
		paragraph += 1;
	}
	const depth = (caseIndex % 5) / 4;
	const split = Math.floor(filler.length * depth);
	return `${filler.slice(0, split)}\nACTIVE COMPACTABLE TRANSCRIPT FACTS:\n${facts}\n${filler.slice(split)}`;
}

export function buildContextIntegrityPrompts(
	contextWindow = CONTEXT_INTEGRITY_CONTEXT_WINDOW,
): readonly ContextIntegrityPrompt[] {
	const prompts: ContextIntegrityPrompt[] = [];
	for (const [caseIndex, case_] of buildContextIntegrityCases().entries()) {
		for (const utilisation of CONTEXT_UTILISATION_LEVELS) {
			prompts.push({
				caseId: case_.id,
				arm: `raw_${Math.round(utilisation * 100) as 50 | 75 | 90}`,
				content: `${rawContext(case_, utilisation, contextWindow)}\n\nQUESTION:\n${case_.question}`,
				requestedUtilisation: utilisation,
			});
		}
		const rendered = renderAllArms(case_.facts, caseIndex + 1);
		for (const format of COMPACTION_FORMATS) {
			prompts.push({
				caseId: case_.id,
				arm: format,
				content: `COMPACTED TRANSCRIPT:\n${rendered[format].text}\n\nQUESTION:\n${case_.question}`,
				requestedUtilisation: null,
			});
		}
	}
	return prompts;
}

/** Rotate the six-arm order so no format or utilisation level permanently owns a hot/cold position. */
export function orderContextIntegrityPrompts(
	prompts: readonly ContextIntegrityPrompt[],
): readonly ContextIntegrityPrompt[] {
	const ordered: ContextIntegrityPrompt[] = [];
	for (const [caseIndex, case_] of buildContextIntegrityCases().entries()) {
		const casePrompts = prompts.filter((prompt) => prompt.caseId === case_.id);
		const offset = caseIndex % Math.max(1, casePrompts.length);
		ordered.push(...casePrompts.slice(offset), ...casePrompts.slice(0, offset));
	}
	return ordered;
}

export function scoreContextIntegrityAnswer(case_: ContextIntegrityCase, answer: string): number {
	const normalized = answer.toLowerCase().replace(/\s+/gu, " ");
	const caught = case_.expectedFragments.filter((fragment) => normalized.includes(fragment.toLowerCase())).length;
	return caught / case_.expectedFragments.length;
}

export interface ContextIntegritySummary {
	readonly taskCount: number;
	readonly observationCount: number;
	readonly infraErrorRate: number;
	readonly meanScoreByArm: Readonly<Record<ContextIntegrityArm, number>>;
	readonly meanPromptUtilisationByRawArm: Readonly<Record<`raw_${50 | 75 | 90}`, number | null>>;
	readonly measuredCompactionThreshold: number | null;
	readonly formatDecision: "winner" | "unresolved";
	readonly formatWinner: CompactionFormat | null;
	readonly formatMarginPoints: number;
	readonly preRegistration: ReturnType<typeof assessPreRegistration>;
}

export function summarizeContextIntegrityExperiment(
	observations: readonly ContextIntegrityObservation[],
	contextWindow = CONTEXT_INTEGRITY_CONTEXT_WINDOW,
): ContextIntegritySummary {
	const arms: readonly ContextIntegrityArm[] = ["raw_50", "raw_75", "raw_90", ...COMPACTION_FORMATS];
	const usable = observations.filter((row) => row.infraError === null);
	const mean = (arm: ContextIntegrityArm): number => {
		const rows = usable.filter((row) => row.arm === arm);
		return rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.score, 0) / rows.length;
	};
	const meanScoreByArm = Object.fromEntries(arms.map((arm) => [arm, mean(arm)])) as Record<
		ContextIntegrityArm,
		number
	>;
	const rawArms = ["raw_50", "raw_75", "raw_90"] as const;
	const meanPromptUtilisationByRawArm = Object.fromEntries(
		rawArms.map((arm) => {
			const tokens = usable
				.filter((row) => row.arm === arm && row.promptTokens !== null)
				.map((row) => row.promptTokens as number);
			return [
				arm,
				tokens.length === 0 ? null : tokens.reduce((sum, value) => sum + value, 0) / tokens.length / contextWindow,
			];
		}),
	) as Record<(typeof rawArms)[number], number | null>;
	const baseline = meanScoreByArm.raw_50;
	const degradedArm = rawArms
		.slice(1)
		.find((arm) => (baseline - meanScoreByArm[arm]) * 100 >= CONTEXT_INTEGRITY_MDE_POINTS);
	const measuredCompactionThreshold = degradedArm ? meanPromptUtilisationByRawArm[degradedArm] : null;
	const rankedFormats = [...COMPACTION_FORMATS].sort((left, right) => meanScoreByArm[right] - meanScoreByArm[left]);
	const formatMarginPoints =
		(meanScoreByArm[rankedFormats[0] as CompactionFormat] - meanScoreByArm[rankedFormats[1] as CompactionFormat]) *
		100;
	const formatDecision = formatMarginPoints >= CONTEXT_INTEGRITY_MDE_POINTS ? "winner" : "unresolved";
	return {
		taskCount: new Set(observations.map((row) => row.caseId)).size,
		observationCount: observations.length,
		infraErrorRate: observations.length === 0 ? 0 : (observations.length - usable.length) / observations.length,
		meanScoreByArm,
		meanPromptUtilisationByRawArm,
		measuredCompactionThreshold,
		formatDecision,
		formatWinner: formatDecision === "winner" ? (rankedFormats[0] as CompactionFormat) : null,
		formatMarginPoints,
		preRegistration: assessPreRegistration({
			declaredMdePoints: CONTEXT_INTEGRITY_MDE_POINTS,
			design: { taskCount: CONTEXT_INTEGRITY_TASK_COUNT, paired: true, repeats: 1, clusterInflation: 1 },
		}),
	};
}
