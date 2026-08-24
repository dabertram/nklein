import {
	assessFrontierFreshness,
	buildFrontierSynthesisMessages,
	clampFrontierSynthesis,
	FRONTIER_RESEARCH_QUESTIONS,
	FRONTIER_SYNTHESIS_JSON_SCHEMA,
	type FrontierEvidenceSource,
	type FrontierReport,
	type FrontierRunResponse,
	type FrontierStatusResponse,
	frontierSynthesisSchema,
} from "../core/frontier-research";
import { appendFrontierReport, readLatestFrontierReport } from "../state/frontier-research-store";

/**
 * Frontier-radar runner — the effectful composition behind the always-visible status icon: run the
 * canonical research sweep through the EGRESS-GATED retrieval loop, hand the fetched evidence to the most
 * capable local model for structured synthesis, stamp + persist the report. Single-flight; every refusal
 * is a named reason (egress off, no model, already running) — the icon must never lie about why the radar
 * is dark. Acquisition stays out of scope on purpose: the report RECOMMENDS models, the operator fetches
 * them through the consent-gated path (P25.2b).
 */

export interface FrontierResearchRunnerDeps {
	/** Egress-gated retrieval (§5.AC). Null when retrieval egress is off — the runner refuses honestly. */
	runRetrieval: ((question: string) => Promise<{ sources: readonly FrontierEvidenceSource[] }>) | null;
	/** The most capable local model, as a ready structured-output client. Null when nothing is loaded. */
	createSynthesisClient: () => Promise<{
		modelId: string;
		generateStructured: (input: {
			messages: { role: "system" | "user"; content: string }[];
			schema: Record<string, unknown>;
		}) => Promise<unknown>;
	} | null>;
	installedModels: () => Promise<readonly string[]>;
	mechanisms: () => Promise<readonly string[]>;
	deviceRamGb: () => number | null;
	isEgressEnabled: () => Promise<boolean> | boolean;
	now?: () => number;
	/** Store override for tests. */
	storeRootDir?: string;
	onLog?: (line: string) => void;
}

export interface FrontierResearchRunner {
	status(): Promise<FrontierStatusResponse>;
	latest(): Promise<FrontierReport | null>;
	run(): Promise<FrontierRunResponse>;
}

export function createFrontierResearchRunner(deps: FrontierResearchRunnerDeps): FrontierResearchRunner {
	const now = deps.now ?? (() => Date.now());
	let running = false;

	async function status(): Promise<FrontierStatusResponse> {
		const latest = await readLatestFrontierReport(deps.storeRootDir);
		const freshness = assessFrontierFreshness(now(), latest?.ranAt ?? null);
		return {
			running,
			egressEnabled: await deps.isEgressEnabled(),
			freshness: freshness.status,
			ageDays: freshness.ageDays,
			latestRanAt: latest?.ranAt ?? null,
			latestFunLine: latest?.funLine ?? null,
		};
	}

	async function run(): Promise<FrontierRunResponse> {
		if (running) {
			return { started: false, reason: "A frontier research run is already in progress." };
		}
		if (!(await deps.isEgressEnabled()) || deps.runRetrieval === null) {
			return {
				started: false,
				reason: "Retrieval egress is off — the radar only researches when you have explicitly enabled it.",
			};
		}
		const client = await deps.createSynthesisClient();
		if (!client) {
			return { started: false, reason: "No local model is loaded to run the research synthesis." };
		}
		running = true;
		const runRetrieval = deps.runRetrieval;
		// Fire-and-record: the caller gets `started` immediately; completion shows up in status/latest.
		void (async () => {
			try {
				const sources: FrontierEvidenceSource[] = [];
				for (const question of FRONTIER_RESEARCH_QUESTIONS) {
					try {
						const result = await runRetrieval(question);
						sources.push(...result.sources);
					} catch (error) {
						deps.onLog?.(
							`[frontier] retrieval failed for "${question.slice(0, 60)}…": ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
				const [installedModels, mechanisms] = await Promise.all([deps.installedModels(), deps.mechanisms()]);
				const messages = buildFrontierSynthesisMessages({
					evidence: sources,
					installedModels,
					deviceRamGb: deps.deviceRamGb(),
					mechanisms,
				});
				const raw = await client.generateStructured({
					messages: [
						{ role: "system", content: messages.system },
						{ role: "user", content: messages.user },
					],
					schema: FRONTIER_SYNTHESIS_JSON_SCHEMA,
				});
				const synthesis = frontierSynthesisSchema.parse(clampFrontierSynthesis(raw));
				const report: FrontierReport = {
					...synthesis,
					schemaVersion: 1,
					ranAt: now(),
					researchModelId: client.modelId,
					questionsAsked: [...FRONTIER_RESEARCH_QUESTIONS],
					sourceCount: sources.length,
				};
				await appendFrontierReport(report, deps.storeRootDir);
				deps.onLog?.(
					`[frontier] report ready: ${report.findings.length} finding(s), ${report.modelRecommendations.length} model rec(s), ${report.selfReflection.length} reflection row(s) from ${report.sourceCount} source(s) via ${report.researchModelId}.`,
				);
			} catch (error) {
				deps.onLog?.(`[frontier] research run failed: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				running = false;
			}
		})();
		return { started: true, reason: null };
	}

	return {
		status,
		latest: () => readLatestFrontierReport(deps.storeRootDir),
		run,
	};
}
