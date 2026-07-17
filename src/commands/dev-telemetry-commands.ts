import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentLedgerEvent,
	agentLedgerEventSchema,
	buildTaskEscalationReport,
	selectAttempts,
	summarizeKnowledgeDebtOutcomes,
	summarizeKnowledgeOutcomeByModel,
} from "../core/agent-attempt-ledger";
import { renderSwarmEfficiencyReport, summarizeSwarmEfficiency } from "../core/agent-ledger-efficiency";
import {
	buildModelCapabilityAdvice,
	buildStucknessSignalsFromLedger,
	rankModelsByLedgerFitnessWithVerdict,
	summarizeLedgerForDisplay,
} from "../core/agent-ledger-projections";
import { classifyAgentStuckness, isHardStuck } from "../core/agent-stuckness";
import { learnAnswerBudget } from "../core/answer-budget-learn";
import { buildAnswerSizesByModel } from "../core/answer-budget-projection";
import { nodeBasicMemoryFsDeps, readBasicMemoryNotes } from "../core/basic-memory-note-reader";
import {
	assessCapabilityCeiling,
	buildUpgradeCandidatesFromFitness,
	ceilingHitRoles,
	type FleetModelFitness,
	type MachineMemory,
	type RoleQualityBar,
	recommendCeilingUpgrades,
} from "../core/capability-ceiling-recommendation";
import { type RoutingCandidate, rankRoutingCandidates } from "../core/confidence-resource-routing";
import { recommendContextCap } from "../core/context-size-recommender";
import { buildContextTimingObservationsByModel } from "../core/context-timing-projection";
import { resolveDeviceRamBytesFromEnv } from "../core/device-load-routing";
import { learnReasoningBenefit } from "../core/enforced-reasoning-benefit";
import { buildEscalationSuggestions } from "../core/escalation-suggestions";
import { type EvalCellFreshnessInput, rankEvalCellsForReevaluation } from "../core/eval-freshness-decay";
import { summarizeEvidenceCurrency } from "../core/evidence-currency-status";
import { detectInjectionSpike, summarizeInjectionEvents } from "../core/injection-audit-summary";
import { estimateLearnedRetryBudget } from "../core/learned-retry-budget";
import { buildLedgerEvidence } from "../core/ledger-evidence";
import { fetchLmsLinkDevices } from "../core/lms-link-status";
import { parseLmsLsCatalog } from "../core/lms-model-catalog";
import { createDefaultLmsRunner, fetchLmsPsModels, LOCAL_MACHINE_ID } from "../core/lms-ps-json";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { auditMemoryFreshness } from "../core/memory-freshness-audit";
import { classifyMemoryLifecycle } from "../core/memory-lifecycle";
import {
	dominantFailureMode,
	learnedQualityEffectiveBudget,
	learnedRetryBudget,
	preferredToolCallFormat,
} from "../core/model-behavior-profile";
import { lookupModelCapability } from "../core/model-capability-catalog";
import { summarizeModelRoleStability } from "../core/model-eval-stability";
import { adviseModelFleet } from "../core/model-fleet-advisor";
import { estimateDistractorSensitivity } from "../core/model-sensitive-pruning";
import { summarizeOpportunisticValue } from "../core/opportunistic-work-value";
import { projectCardControllerTrace } from "../core/outer-controller-fsm";
import { summarizeOutwardActionQueue } from "../core/outward-action-queue";
import { scanForPlaceholders } from "../core/placeholder-scan";
import { detectProcessRemediation, peakRemediationLevel } from "../core/process-remediation";
import { buildProcessTrajectoryFromLedger } from "../core/process-remediation-ledger";
import { lintPromptFragment } from "../core/prompt-fragment-lint";
import { assessQualityBudget } from "../core/quality-budget";
import { aggregateRailEvidence, buildRailEvidenceAnalysisPrompt } from "../core/rail-evidence";
import {
	buildRailFindingRetentionEvent,
	classifyRailFindings,
	formatRailFindingsReport,
	proposeRailBacklogPackages,
} from "../core/rail-findings";
import { buildReplayEvalOutcome, orchestrateReplayEvalAutoCapture } from "../core/replay-eval-orchestration";
import { summarizeRetrievalUsefulness } from "../core/retrieval-ledger-projection";
import { buildRetryBudgetObservationsByModel } from "../core/retry-budget-projection";
import {
	backfillRoutingOutcomes,
	type RoutingOutcomeJoin,
	summarizeRoutingCalibration,
} from "../core/routing-decision-log";
import {
	assessRuntimeModelVerdict,
	combineSuitabilityVerdicts,
	type RuntimeRunOutcome,
} from "../core/runtime-model-verdict";
import { assessStubbornFailure, type EscalationAttempt } from "../core/stubborn-failure-escalation";
import { buildStuckTaskAnalysisRequest } from "../core/stuck-task-analysis";
import { assessRosterFit, formatSwarmRosterReport } from "../core/swarm-roster";
import { loadUserSwarmConfig, resolveEffectiveBudgets, resolveEffectiveRosters } from "../core/swarm-roster-config";
import { summarizeTruncationDiagnostics } from "../core/truncation-diagnostics-summary";
import { parseAddedLinesFromUnifiedDiff } from "../core/unified-diff-added-lines";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { buildSwarmMachineView, formatSwarmMachineView } from "../nklein-agent/nklein-swarm-view";
import { runScenarioSuite } from "../nklein-agent/replay-eval-scenario-suite";
import { appendAgentLedgerEvent, readAgentLedger, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { readAllCurrencyEvidence } from "../state/currency-evidence-store";
import { readAllDistractorObservations } from "../state/distractor-observation-store";
import { readAllInjectionEvents } from "../state/injection-event-store";
import { parseValidatedJsonl } from "../state/jsonl-store";
import { readAllModelEvalRuns } from "../state/model-eval-run-store";
import { readOutwardActionQueue, setOutwardActionStatus } from "../state/outward-action-queue-store";
import { readRailEvidenceReports } from "../state/rail-evidence-store";
import { readAllReasoningObservations } from "../state/reasoning-observation-store";
import { readAllRoutingDecisions } from "../state/routing-decision-log-store";
import { readAllTruncationObservations } from "../state/truncation-observation-store";
import { readMergedFitnessRows } from "../telemetry/fitness-table-store";
import { readModelPerformanceStats } from "../telemetry/model-performance-stats";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";
import { createResultWorktree } from "../workspace/replay-eval-worktree";
import { createTaskResultBranchRef } from "../workspace/task-result-branches";

export async function runDevLedgerCommand(options: { json?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const summary = summarizeLedgerForDisplay(events);
	// Rank the SAME way the start path routes: fitness penalized by the runtime verdict (chronic stallers sink), not
	// raw fitness — otherwise this "routing recommendation" disagrees with what selection actually does. Evidence is
	// the same as the router's blend: self-observation failures + the ledger's total-run denominator (best-effort).
	const selfObservationEvents = await readSelfObservationEvents({ limit: 500 }).catch(() => []);
	const { verdictRuns } = await buildLedgerEvidence(async () => events);
	const ranked = rankModelsByLedgerFitnessWithVerdict(events, { selfObservationEvents, verdictRuns });
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...summary, fitnessRanking: ranked }, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Agent Attempt Ledger — ${summary.totalAttempts} attempt(s) across ${summary.totalEvents} event(s)\n\n`,
	);
	if (summary.outcomes.length === 0) {
		process.stdout.write("(no model attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	process.stdout.write("Per-model outcomes:\n");
	for (const outcome of summary.outcomes) {
		const breakdown = Object.entries(outcome.byOutcome)
			.filter(([, count]) => count > 0)
			.map(([kind, count]) => `${kind}×${count}`)
			.join(" ");
		process.stdout.write(
			`  ${outcome.modelId.padEnd(40)} ${String(outcome.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(outcome.successRate * 100)).padStart(3)}% success  [${breakdown}]\n`,
		);
	}
	if (ranked.length > 0) {
		process.stdout.write("\nFitness ranking (§5.AB routing recommendation from real runs — best first):\n");
		for (const row of ranked) {
			process.stdout.write(
				`  ${String(Math.round(row.fitnessScore * 100)).padStart(3)}  ${row.modelId.padEnd(40)} ${row.role.padEnd(10)} ` +
					`${String(row.samples).padStart(3)} run(s)\n`,
			);
		}
	}
	process.stdout.write("\nPer-model × role (the §5.Z matrix, as a ledger query):\n");
	for (const row of summary.byRole) {
		process.stdout.write(
			`  ${row.modelId.padEnd(40)} ${row.role.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(row.successRate * 100)).padStart(3)}% success\n`,
		);
	}
	// W1.4 (audit 2026-07-02): the efficiency/waste scoreboard — tokens/wall per delivered task, wasted-attempt
	// share, re-truncation pairs, retry burden. The tuner for the fail-closed gate + retry-ladder + /no_think fixes.
	process.stdout.write(`\n${renderSwarmEfficiencyReport(summarizeSwarmEfficiency(events))}\n`);
	if (summary.byFlow.length > 0) {
		process.stdout.write("\nPer-model × flow (the §5.Z matrix by board/chat/autonomous):\n");
		for (const row of summary.byFlow) {
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${row.flow.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
					`${String(Math.round(row.successRate * 100)).padStart(3)}% success\n`,
			);
		}
	}
	if (summary.toolUsage.length > 0) {
		process.stdout.write("\nPer-model × tool (usage + outcome — the §5.AA small-model signal):\n");
		for (const row of summary.toolUsage) {
			const completed = row.successes + row.errors;
			const rate = completed > 0 ? `${String(Math.round(row.successRate * 100)).padStart(3)}% ok` : " n/a   ";
			const incomplete = row.incomplete > 0 ? ` (${row.incomplete} incomplete)` : "";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${row.toolName.padEnd(20)} ${String(row.calls).padStart(3)} call(s)  ${rate}${incomplete}\n`,
			);
		}
	}

	if (summary.speed.length > 0) {
		process.stdout.write("\nPer-model speed (from ledger ttft + tok/s — a §5.AB selection signal):\n");
		for (const row of summary.speed) {
			const ttft = row.avgTtftMs !== null ? `${Math.round(row.avgTtftMs)}ms ttft` : "no ttft";
			const tps = row.avgTokensPerSec !== null ? `${row.avgTokensPerSec.toFixed(1)} tok/s` : "no tok/s";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${String(row.samples).padStart(3)} sample(s)  ${ttft.padStart(12)}  ${tps.padStart(12)}\n`,
			);
		}
	}

	if (summary.contextUsage.length > 0) {
		process.stdout.write("\nPer-model context usage (prompt tokens — a §5.AD budget / §5.AB routing signal):\n");
		for (const row of summary.contextUsage) {
			const avg = row.avgContextTokens !== null ? `${Math.round(row.avgContextTokens)} avg` : "n/a";
			const max = row.maxContextTokens !== null ? `${row.maxContextTokens} max` : "n/a";
			const over = row.overBudget > 0 ? `  ${row.overBudget} over-budget` : "";
			process.stdout.write(
				`  ${row.modelId.padEnd(40)} ${String(row.samples).padStart(3)} sample(s)  ${avg.padStart(12)}  ${max.padStart(12)}${over}\n`,
			);
		}
	}

	if (summary.profiles.length > 0) {
		// §5.AA/§5.AD: the LEARNED per-model signals the adaptive loop reads — made inspectable. Retry budget (more for a
		// flakier model), quality-effective context budget (the §5.AD knee to target, never the max), the dominant failure
		// mode, and the preferred tool-call format — all derived from the ledger, not a second store.
		process.stdout.write("\nPer-model learned profile (§5.AA/§5.AD — what the adaptive loop has learned):\n");
		for (const profile of summary.profiles) {
			const retry = `retry≤${learnedRetryBudget(profile)}`;
			const qualityBudget = learnedQualityEffectiveBudget(profile);
			const budget = qualityBudget !== null ? `qbudget ${qualityBudget}` : "qbudget n/a";
			const failure = dominantFailureMode(profile);
			const failureLabel = failure ? `mostly ${failure}` : "no dominant failure";
			const format = preferredToolCallFormat(profile);
			const formatLabel = format ? `, fmt ${format}` : "";
			process.stdout.write(
				`  ${profile.modelId.padEnd(40)} ${String(profile.samples).padStart(3)} sample(s)  ${`${Math.round(profile.successRate * 100)}% ok`.padStart(7)}  ${retry.padStart(9)}  ${budget.padStart(14)}  ${failureLabel}${formatLabel}\n`,
			);
		}
	}
}

export async function runDevModelVerdictCommand(options: { modelId?: string; json?: boolean } = {}): Promise<void> {
	// §5.AL runtime-unsuitability surface: derive an evidence-based verdict per model from the persisted telemetry —
	// self-observation signals (model_stalled etc.) for the negatives + the agent ledger for the run denominator.
	const events = await readSelfObservationEvents({ limit: 500 });
	const attempts = selectAttempts(await readAllAgentLedger());
	const runs: RuntimeRunOutcome[] = attempts.map((attempt) => ({
		runId: attempt.attemptId,
		modelId: attempt.modelId,
	}));

	const requested = options.modelId?.trim();
	const modelIds = requested
		? [requested]
		: [...new Set([...runs.map((run) => run.modelId), ...events.map((event) => event.modelId)])].filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			);

	const combined = modelIds
		.map((modelId) => {
			const runtime = assessRuntimeModelVerdict({ modelId, events, runs });
			const catalogVerdict = lookupModelCapability(modelId)?.toolUse ?? "UNKNOWN";
			return combineSuitabilityVerdicts(catalogVerdict, runtime);
		})
		.sort(
			(left, right) =>
				right.runtime.sampleCount - left.runtime.sampleCount || left.modelId.localeCompare(right.modelId),
		);

	if (options.json) {
		process.stdout.write(`${JSON.stringify(combined, null, 2)}\n`);
		return;
	}
	if (combined.length === 0) {
		process.stdout.write("(no runtime evidence recorded yet — run some tasks, then re-check)\n");
		return;
	}
	process.stdout.write("Model suitability — catalog (pre-flight) × runtime (evidence) (§5.AL):\n");
	for (const c of combined) {
		const v = c.runtime;
		const stalls = v.signalCounts.model_stalled;
		process.stdout.write(
			`  ${c.modelId.padEnd(40)} catalog ${c.catalogVerdict.padEnd(16)} runtime ${v.verdict.padEnd(16)} ` +
				`⇒ ${c.recommended.padEnd(16)} [${c.flag}]\n` +
				`      ${String(v.sampleCount).padStart(3)} run(s)  ${`${Math.round(v.stallRate * 100)}% stall`.padStart(10)} (${stalls})  ${c.note}\n`,
		);
	}
}

export async function runDevSwarmCommand(options: { json?: boolean } = {}): Promise<void> {
	// §5.AB operator view: read the loaded instances via `lms ps --json` (the only source of the per-MACHINE deviceId,
	// since LM Link shares machines behind one endpoint) and annotate each with the auto-selector's affinity view.
	const run = createDefaultLmsRunner();
	const [view, devices] = await Promise.all([
		fetchLmsPsModels(run).then(buildSwarmMachineView),
		fetchLmsLinkDevices(run), // hex deviceId → friendly machine name
	]);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
		return;
	}
	const label = (machineId: string): string =>
		machineId === LOCAL_MACHINE_ID
			? `${devices.localMachineName ?? "local"} (this host)`
			: (devices.namesByDeviceId.get(machineId) ?? machineId);
	process.stdout.write("!Klein swarm — loaded models per machine, with the auto-selection view (§5.AB):\n\n");
	process.stdout.write(formatSwarmMachineView(view, label));
}

export async function runDevFleetAdviceCommand(options: { json?: boolean; endpoint?: string } = {}): Promise<void> {
	// §5.AB gap 5 / §5.AL: advise what to ADD to the loaded fleet (family diversity + reasoning depth) so reviews and
	// escalations get an uncorrelated, deep second opinion. Reads the loaded descriptors (real keys → lineage/catalog);
	// best-effort — an unreachable endpoint yields the "no agentic model" advice, never a throw.
	const base = options.endpoint?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL;
	const descriptors = await fetchLoadedModelDescriptors(base).catch(() => []);
	const suggestions = adviseModelFleet(descriptors);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ loadedModels: descriptors.length, suggestions }, null, 2)}\n`);
		return;
	}
	process.stdout.write("!Klein fleet advice — what to add to strengthen the loaded model set (§5.AB/§5.AL):\n\n");
	if (suggestions.length === 0) {
		process.stdout.write("  ✓ The loaded fleet is family-diverse and has reasoning depth — nothing to suggest.\n");
		return;
	}
	for (const suggestion of suggestions) {
		const mark = suggestion.severity === "warn" ? "⚠" : "•";
		process.stdout.write(`  ${mark} ${suggestion.title}\n    ${suggestion.detail}\n\n`);
	}
}

export async function runDevAdviceCommand(options: { json?: boolean }): Promise<void> {
	const advice = buildModelCapabilityAdvice(await readAllAgentLedger());
	if (options.json) {
		process.stdout.write(`${JSON.stringify(advice, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Model capability advice (§5.AB) — which model to trust per role, from real ledger outcomes\n\n",
	);
	if (advice.perRole.length === 0) {
		process.stdout.write("(no model attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	for (const row of advice.perRole) {
		const failure = row.topFailureMode ? ` (mostly ${row.topFailureMode})` : "";
		process.stdout.write(
			`  ${row.modelId.padEnd(40)} ${row.role.padEnd(10)} ${String(row.samples).padStart(3)} run(s)  ` +
				`${String(Math.round(row.successRate * 100)).padStart(3)}%  ${row.verdict}${failure}\n`,
		);
	}
	if (advice.notes.length > 0) {
		process.stdout.write("\nPer-role guidance:\n");
		for (const note of advice.notes) {
			process.stdout.write(`  • ${note}\n`);
		}
	}
}

/** Default per-role quality bars for the capability-ceiling read (a loaded model must clear these). */
const DEFAULT_ROLE_QUALITY_BARS: Readonly<Record<string, number>> = {
	architect: 0.7,
	decompose: 0.7,
	reviewer: 0.7,
	worker: 0.6,
};
const FALLBACK_ROLE_BAR = 0.6;

/** F3.35 — surface the roles the LOADED fleet cannot clear, from real ledger fitness + `lms ps` loaded state. */
export async function runDevCapabilityCeilingCommand(
	options: { json?: boolean; endpoint?: string } = {},
): Promise<void> {
	const advice = buildModelCapabilityAdvice(await readAllAgentLedger());
	const base = options.endpoint?.trim() || DEFAULT_LOCAL_MODEL_BASE_URL;
	const descriptors = await fetchLoadedModelDescriptors(base).catch(() => []);
	const loadedTokens = descriptors.flatMap((d) => [d.runtimeId, d.modelKey].filter((t): t is string => Boolean(t)));
	const isLoaded = (modelId: string): boolean => loadedTokens.some((token) => modelId.includes(token));

	const fitness: FleetModelFitness[] = advice.perRole.map((row) => ({
		modelKey: row.modelId,
		role: row.role,
		qualityConfidence: row.successRate,
		loaded: isLoaded(row.modelId),
	}));
	const roles = [...new Set(advice.perRole.map((row) => row.role))];
	const bars: RoleQualityBar[] = roles.map((role) => ({
		role,
		minConfidence: DEFAULT_ROLE_QUALITY_BARS[role] ?? FALLBACK_ROLE_BAR,
	}));
	const verdicts = assessCapabilityCeiling(bars, fitness);
	const hits = ceilingHitRoles(verdicts);

	// F3.35 enrichment: for each ceiling-hit role, name the exact NOT-loaded catalog model to load, where it lives, and
	// whether it fits. Candidates come from the fitness store (capability + samples, populated by the model sweep), joined
	// with the `lms ls` catalog (machine + size) and the fleet RAM map (NKLEIN_DEVICE_RAM_GB).
	const upgrades = await buildCapabilityCeilingUpgrades(verdicts, isLoaded);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ verdicts, ceilingHits: hits, upgrades }, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Capability ceiling (F3.35) — roles the LOADED fleet cannot clear, from real ledger fitness\n\n",
	);
	if (roles.length === 0) {
		process.stdout.write("(no model attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	if (hits.length === 0) {
		process.stdout.write("✓ No capability ceiling: every measured role has a loaded model clearing its bar.\n");
	}
	for (const hit of hits) {
		process.stdout.write(`  ⚠ ${hit.recommendation}\n`);
		const upgrade = upgrades.find((u) => u.role === hit.role);
		if (upgrade) {
			process.stdout.write(`     → ${upgrade.recommendation}\n`);
		}
	}
	const sufficient = verdicts.filter((v) => v.status === "sufficient");
	if (sufficient.length > 0) {
		process.stdout.write(
			`\nSufficient roles: ${sufficient.map((v) => `${v.role} (${v.bestLoaded?.modelKey.split(":")[1] ?? "?"})`).join(", ")}\n`,
		);
	}
}

/**
 * F3.35 enrichment glue: build the fleet catalog inputs from live sources and rank the best NOT-loaded upgrade per
 * ceiling-hit role. Candidates = fitness rows (capability = per-(model,role) success rate, samples = sampleCount)
 * JOINED with the `lms ls` catalog for machine + size. Machines = the NKLEIN_DEVICE_RAM_GB map (bytes → GB). Best-effort:
 * any source failing degrades to an empty recommendation set (never throws into the CLI).
 */
async function buildCapabilityCeilingUpgrades(
	verdicts: readonly ReturnType<typeof assessCapabilityCeiling>[number][],
	isLoaded: (modelId: string) => boolean,
): Promise<ReturnType<typeof recommendCeilingUpgrades>> {
	try {
		const fitnessRows = Object.values(await readMergedFitnessRows());
		const lsOut = await createDefaultLmsRunner()(["ls"])
			.then((r) => r.stdout)
			.catch(() => "");
		const catalog = parseLmsLsCatalog(lsOut, { localDeviceName: LOCAL_MACHINE_ID });
		const candidates = buildUpgradeCandidatesFromFitness(fitnessRows, catalog, isLoaded);
		const ramBytes = resolveDeviceRamBytesFromEnv();
		const machines: MachineMemory[] = Object.entries(ramBytes).map(([machine, bytes]) => ({
			machine,
			usableGB: bytes / 1024 ** 3,
		}));
		return recommendCeilingUpgrades(verdicts, candidates, machines);
	} catch {
		return [];
	}
}

/** Phase 7S / S11 — injection pre-screen audit: which ingestion surfaces are being hit, per recorded events. */
export async function runDevSecurityEventsCommand(options: { json?: boolean } = {}): Promise<void> {
	const events = await readAllInjectionEvents();
	const summaries = summarizeInjectionEvents(events);
	const alert = detectInjectionSpike(events, { now: Date.now() });
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ alert, summaries }, null, 2)}\n`);
		return;
	}
	process.stdout.write("Security events (Phase 7S / S11) — injection pre-screen hits per ingestion surface\n\n");
	// Lead with the block-rate alert so an active campaign is the first thing the operator sees.
	if (alert.triggered) {
		process.stdout.write(`  ⚠ ALERT: ${alert.reason}\n`);
		for (const s of alert.bySurface) {
			process.stdout.write(`      · ${s.surface}: ${s.recentBlocks} recent block(s)\n`);
		}
		process.stdout.write("\n");
	} else {
		process.stdout.write(`  ✓ ${alert.reason}\n\n`);
	}
	if (summaries.length === 0) {
		process.stdout.write("(no injection screen hits recorded — clean, or the recording wire is not yet active)\n");
		return;
	}
	for (const s of summaries) {
		process.stdout.write(
			`  ${s.surface}: ${s.blocked} blocked · ${s.suspicious} flagged · ${s.distinctSources} source(s)` +
				`${s.topFinding ? ` · top: ${s.topFinding}` : ""}\n`,
		);
	}
}

/**
 * Phase 7S / S3 — the outward-action review queue: list pending/approved/rejected outward actions the autonomous path
 * recorded for review, or approve/reject one by id. This is the operator's human-in-the-loop surface for the "queue for
 * later review" model.
 */
export async function runDevOutwardQueueCommand(
	options: { json?: boolean; approve?: string; reject?: string } = {},
): Promise<void> {
	if (options.approve || options.reject) {
		const id = (options.approve ?? options.reject) as string;
		const status = options.approve ? "approved" : "rejected";
		const ok = await setOutwardActionStatus(id, status, undefined);
		process.stdout.write(ok ? `Marked ${id} as ${status}.\n` : `No queued action with id ${id}.\n`);
		return;
	}
	const actions = await readOutwardActionQueue();
	const summary = summarizeOutwardActionQueue(actions);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ summary, actions }, null, 2)}\n`);
		return;
	}
	process.stdout.write("Outward-action review queue (Phase 7S / S3) — outward actions awaiting operator review\n\n");
	process.stdout.write(
		`  ${summary.pending} pending · ${summary.approved} approved · ${summary.rejected} rejected\n\n`,
	);
	const pending = actions.filter((action) => action.status === "pending");
	if (pending.length === 0) {
		process.stdout.write("(nothing pending — the queue is empty or all actions are reviewed)\n");
		return;
	}
	for (const action of pending) {
		process.stdout.write(
			`  [${action.id}] ${action.toolName} → ${action.target}\n      args: ${action.argsSummary}\n`,
		);
	}
	process.stdout.write("\nApprove/reject with: dev outward-queue --approve <id> | --reject <id>\n");
}

/** F4.12 — per-model truncation diagnostics (reasoning-starved vs answer-capped vs ceiling) from recorded observations. */
export async function runDevTruncationDiagnosticsCommand(options: { json?: boolean } = {}): Promise<void> {
	const summaries = summarizeTruncationDiagnostics(await readAllTruncationObservations());
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
		return;
	}
	process.stdout.write("Truncation diagnostics (F4.12) — WHY completions hit the length limit, per model\n\n");
	if (summaries.length === 0) {
		process.stdout.write(
			"(no truncation observations recorded yet — the chat/swarm/review recording wire is opt-in; enable it, then re-check)\n",
		);
		return;
	}
	for (const s of summaries) {
		process.stdout.write(
			`  ${s.modelId}: ${s.total} truncation(s) — ${s.byCause.reasoning_starved_answer} reasoning-starved · ` +
				`${s.byCause.answer_budget} answer-capped · ${s.byCause.total_ceiling} ceiling → ${s.recommendation}\n`,
		);
	}
}

/** F3.30 — per-model learned retry budgets (useful same-model retries before diminishing returns) from the ledger. */
export async function runDevRetryBudgetsCommand(options: { json?: boolean } = {}): Promise<void> {
	const byModel = buildRetryBudgetObservationsByModel(await readAllAgentLedger());
	const rows = [...byModel.entries()].map(([modelId, observations]) => ({
		modelId,
		...estimateLearnedRetryBudget(observations),
	}));
	if (options.json) {
		process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Learned retry budgets (F3.30) — useful same-model retries per model from real ledger history\n\n",
	);
	if (rows.length === 0) {
		process.stdout.write("(no attempts recorded yet — run some tasks, then re-check)\n");
		return;
	}
	for (const row of rows) {
		process.stdout.write(`  ${row.modelId}: ${row.recommendedMaxRetries} retries — ${row.reason}\n`);
	}
}

/** F4.10 — per-model learned answer budgets (output-token p90+margin) from real model-performance observations. */
export async function runDevAnswerBudgetsCommand(options: { json?: boolean } = {}): Promise<void> {
	const stats = await readModelPerformanceStats({ limit: 5000 });
	const byModel = buildAnswerSizesByModel(
		stats.observations.map((observation) => ({ modelId: observation.modelId, usage: observation.usage })),
	);
	const rows = [...byModel.entries()].map(([modelId, sizes]) => ({ modelId, ...learnAnswerBudget(sizes) }));
	if (options.json) {
		process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
		return;
	}
	process.stdout.write("Learned answer budgets (F4.10) — per-model output-token budget from real observations\n\n");
	if (rows.length === 0) {
		process.stdout.write("(no observations with token usage yet — run some tasks, then re-check)\n");
		return;
	}
	for (const row of rows) {
		const confidence = row.confident ? "" : " (low-confidence)";
		process.stdout.write(`  ${row.modelId}: ${row.budgetTokens} tok${confidence} (${row.samples} samples)\n`);
	}
}

/** F4.9 — per-model context-size recommendations from real ledger timing (context load vs wall time / stalls). */
export async function runDevContextRecommendationsCommand(options: { json?: boolean } = {}): Promise<void> {
	const byModel = buildContextTimingObservationsByModel(await readAllAgentLedger());
	const rows = [...byModel.entries()].map(([modelId, observations]) => ({
		modelId,
		...recommendContextCap(observations),
	}));
	if (options.json) {
		process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Context-size recommendations (F4.9) — per-model caps from real ledger context-vs-speed timing\n\n",
	);
	if (rows.length === 0) {
		process.stdout.write("(no attempts with recorded context timing yet — run some tasks, then re-check)\n");
		return;
	}
	for (const row of rows) {
		const cap =
			row.recommendedMaxContextTokens === null ? "no cap needed" : `cap ${row.recommendedMaxContextTokens} tok`;
		const confidence = row.confident ? "" : " (low-confidence)";
		process.stdout.write(`  ${row.modelId}: ${cap}${confidence} — ${row.reason}\n`);
		for (const adaptation of row.adaptations) {
			process.stdout.write(`      · ${adaptation}\n`);
		}
	}
}

/** F3.26 — rank fitness cells by re-evaluation priority (staleness × uncertainty × impact) from the real store. */
export async function runDevEvalFreshnessCommand(options: { json?: boolean; limit?: number } = {}): Promise<void> {
	const rows = Object.values(await readMergedFitnessRows());
	const now = Date.now();
	const cells: EvalCellFreshnessInput[] = rows.map((row) => ({
		cellKey: `${row.modelKey}::${row.role}::${row.difficultyTier}`,
		sampleCount: row.sampleCount,
		lastEvaluatedAt: row.updatedAt,
		// The store carries no per-cell version signature yet, so version-staleness is disabled (age-based only).
		recordedVersionSignature: null,
		currentVersionSignature: "",
		usageCount: row.sampleCount,
	}));
	const ranked = rankEvalCellsForReevaluation(cells, undefined, now);
	const limit = options.limit ?? 15;

	if (options.json) {
		process.stdout.write(`${JSON.stringify(ranked.slice(0, limit), null, 2)}\n`);
		return;
	}
	process.stdout.write(
		"Eval re-evaluation priority (F3.26) — cells to re-run first (staleness × uncertainty × impact)\n\n",
	);
	if (ranked.length === 0) {
		process.stdout.write("(no fitness cells recorded yet — run some evals/tasks, then re-check)\n");
		return;
	}
	for (const cell of ranked.slice(0, limit)) {
		const reasons = cell.reasons.length > 0 ? ` — ${cell.reasons.join(", ")}` : "";
		process.stdout.write(`  ${String(Math.round(cell.priority * 100)).padStart(3)}  ${cell.cellKey}${reasons}\n`);
	}
}

/** Run `git diff <base>` and parse it into per-file added lines — the shared input for the diff-based dev scanners. */
async function readDiffAddedLineFiles(base: string): Promise<{ path: string; addedLines: readonly string[] }[]> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	const run = promisify(execFile);
	const { stdout } = await run("git", ["diff", "--no-color", base], { maxBuffer: 64 * 1024 * 1024 }).catch(
		(error: unknown) => {
			throw new Error(`git diff ${base} failed: ${error instanceof Error ? error.message : String(error)}`);
		},
	);
	return parseAddedLinesFromUnifiedDiff(stdout).map((file) => ({ path: file.path, addedLines: file.addedLines }));
}

/** placeholder-scan (opencode-swarm port) — scan a real git diff's added lines for unfinished-work markers and stubs. */
export async function runDevPlaceholderScanCommand(options: { base?: string; json?: boolean } = {}): Promise<void> {
	const base = options.base?.trim() || "HEAD";
	const diffFiles = await readDiffAddedLineFiles(base);
	const files = diffFiles.map((file) => ({ path: file.path, content: file.addedLines.join("\n") }));
	const result = scanForPlaceholders(files);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ base, filesScanned: files.length, ...result }, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Placeholder scan (opencode-swarm port) — added lines of \`git diff ${base}\` across ${files.length} file(s)\n\n`,
	);
	if (!result.hasPlaceholders) {
		process.stdout.write("  no placeholders introduced by this diff (clean)\n");
		return;
	}
	const summaryLine = Object.entries(result.summary)
		.filter(([, count]) => count > 0)
		.map(([kind, count]) => `${kind}×${count}`)
		.join(" ");
	process.stdout.write(`  ${summaryLine}\n\n`);
	for (const finding of result.findings.slice(0, 40)) {
		process.stdout.write(`  [${finding.kind}] ${finding.path} +${finding.line}: ${finding.snippet}\n`);
	}
	if (result.findings.length > 40) {
		process.stdout.write(`  … and ${result.findings.length - 40} more\n`);
	}
}

/** quality-budget (opencode-swarm port) — assess a real git diff against the per-file/test-ratio/duplication budget. */
export async function runDevQualityBudgetCommand(options: { base?: string; json?: boolean } = {}): Promise<void> {
	const base = options.base?.trim() || "HEAD";
	const files = await readDiffAddedLineFiles(base);
	const result = assessQualityBudget(files);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ base, filesScanned: files.length, ...result }, null, 2)}\n`);
		return;
	}
	const { metrics } = result;
	process.stdout.write(
		`Quality budget (opencode-swarm port) — added lines of \`git diff ${base}\` across ${files.length} file(s)\n\n`,
	);
	process.stdout.write(
		`  source +${metrics.sourceAddedLines} · test +${metrics.testAddedLines} · test-ratio ${metrics.testRatio.toFixed(2)} · ` +
			`largest file +${metrics.maxFileAddedLines} · duplication ${(metrics.duplicationRatio * 100).toFixed(0)}%\n\n`,
	);
	if (result.withinBudget) {
		process.stdout.write("  within budget (no quality violations)\n");
		return;
	}
	for (const violation of result.violations) {
		process.stdout.write(`  [${violation.kind}] ${violation.path ?? "(whole change)"}: ${violation.detail}\n`);
	}
}

/** PRM (opencode-swarm port) — replay a card's real ledger trajectory through the process-remediation detector. */
export async function runDevRemediationCommand(options: { taskId: string; json?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const trajectory = buildProcessTrajectoryFromLedger(events, options.taskId);
	const findings = detectProcessRemediation(trajectory);
	const peak = peakRemediationLevel(findings);
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ taskId: options.taskId, steps: trajectory.steps.length, peakLevel: peak, findings }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(
		`Process remediation (PRM, opencode-swarm port) — task ${options.taskId}: ${trajectory.steps.length} trajectory step(s)\n\n`,
	);
	if (trajectory.steps.length === 0) {
		process.stdout.write("(no attempt events for this task — run it, then re-check)\n");
		return;
	}
	if (findings.length === 0) {
		process.stdout.write("  no process-remediation patterns detected (healthy trajectory)\n");
		return;
	}
	process.stdout.write(`  peak level: L${peak}\n\n`);
	for (const finding of findings) {
		process.stdout.write(`  [L${finding.level}] ${finding.pattern.padEnd(16)} — ${finding.detail}\n`);
	}
}

/** F1.1 — does consulting knowledge tools (and carrying knowledge debt) actually change outcomes? Ledger projection. */
export async function runDevKnowledgeOutcomesCommand(options: { json?: boolean } = {}): Promise<void> {
	const events = await readAllAgentLedger();
	const byModel = summarizeKnowledgeOutcomeByModel(events);
	const debt = summarizeKnowledgeDebtOutcomes(events);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ byModel, debt }, null, 2)}\n`);
		return;
	}
	process.stdout.write("Knowledge outcomes (F1.1) — does consulting knowledge tools change success?\n\n");
	if (byModel.length === 0) {
		process.stdout.write("(no attempts with knowledge-tool signals recorded yet — run some tasks, then re-check)\n");
		return;
	}
	process.stdout.write("Per-model knowledge lift (success rate WITH knowledge − WITHOUT):\n");
	for (const row of byModel) {
		const lift =
			row.knowledgeLift === null
				? "  n/a"
				: `${row.knowledgeLift >= 0 ? "+" : ""}${(row.knowledgeLift * 100).toFixed(0)}%`;
		process.stdout.write(
			`  ${row.modelId.padEnd(38)} ${row.role.padEnd(10)} lift ${lift.padStart(5)}  ` +
				`[with ${row.successesWithKnowledge}/${row.attemptsWithKnowledge} · without ${row.successesWithoutKnowledge}/${row.attemptsWithoutKnowledge}]\n`,
		);
	}
	const debtLift =
		debt.debtLift === null ? "n/a" : `${debt.debtLift >= 0 ? "+" : ""}${(debt.debtLift * 100).toFixed(0)}%`;
	process.stdout.write(
		`\nKnowledge-debt lift: ${debtLift} ` +
			`[with-debt ${debt.successesWithDebt}/${debt.attemptsWithDebt} · without ${debt.successesWithoutDebt}/${debt.attemptsWithoutDebt}]\n`,
	);
}

/** F1.36 — did opportunistic idle work pay off? Project the ledger into per-kind dispatched/realized value rates. */
export async function runDevOpportunisticValueCommand(options: { json?: boolean } = {}): Promise<void> {
	const events = await readAllAgentLedger();
	const summaries = summarizeOpportunisticValue(events);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Opportunistic-work value (F1.36) — ${summaries.length} work kind(s) in the ledger\n\n`);
	if (summaries.length === 0) {
		process.stdout.write("(no opportunistic-work outcomes recorded yet — enable the idle sweep, then re-check)\n");
		return;
	}
	for (const row of summaries) {
		process.stdout.write(
			`  ${row.kind.padEnd(28)} ${String(row.dispatched).padStart(4)} dispatched  ` +
				`${String(Math.round(row.realizedRate * 100)).padStart(3)}% realized  ` +
				`[realized ${row.realized} · no-value ${row.noValue} · errored ${row.errored}]\n`,
		);
	}
}

/** F4.3 — over captured retrieved sources, is the evidence CURRENT (fresh/corroborated) or stale? Sanitized read. */
export async function runDevEvidenceCurrencyCommand(options: { json?: boolean } = {}): Promise<void> {
	const evidence = await readAllCurrencyEvidence().catch(() => []);
	const summary = summarizeEvidenceCurrency(evidence, Date.now());
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ sources: evidence.length, ...summary }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Evidence currency (F4.3) — ${evidence.length} captured source(s)\n\n`);
	if (evidence.length === 0) {
		process.stdout.write(
			"(no retrieved sources captured yet — run web_research with the tool enabled, then re-check)\n",
		);
		return;
	}
	process.stdout.write(`  status: ${summary.status}\n`);
	process.stdout.write(
		`  ${summary.supportCount} supporting · ${summary.highTrustSupportCount} high-trust · ${summary.conflictCount} conflict(s)\n`,
	);
	// The sanitized, injection-safe annotation is F4.3's intended agent-output surface.
	process.stdout.write(`  annotation: ${summary.annotation}\n`);
}

/** F4.13 — over recorded noise A/B observations, how distractor-SENSITIVE is each (model, role, difficulty) cell? */
export async function runDevDistractorSensitivityCommand(options: { json?: boolean } = {}): Promise<void> {
	const observations = await readAllDistractorObservations().catch(() => []);
	const byCell = new Map<string, typeof observations>();
	for (const obs of observations) {
		const key = `${obs.modelId}::${obs.role}::${obs.difficulty}`;
		const list = byCell.get(key) ?? [];
		list.push(obs);
		byCell.set(key, list);
	}
	const rows = [...byCell.entries()].map(([key, cellObs]) => ({
		key,
		sensitivity: estimateDistractorSensitivity(cellObs),
		samples: cellObs.length,
	}));
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ observations: observations.length, cells: rows }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Distractor sensitivity (F4.13) — ${observations.length} noise A/B observation(s)\n\n`);
	if (rows.length === 0) {
		process.stdout.write(
			"(no noise A/B observations yet — run an eval with the distractor probe enabled, then re-check)\n",
		);
		return;
	}
	for (const { key, sensitivity, samples } of rows.sort((a, b) => b.sensitivity - a.sensitivity)) {
		process.stdout.write(
			`  ${key.padEnd(48)} sensitivity ${sensitivity.toFixed(2)} (${sensitivity >= 0.5 ? "prune hard" : "robust"}) ` +
				`[${samples} sample(s)]\n`,
		);
	}
}

/** F3.16 — over recorded reasoning A/B observations, does forcing reasoning help each (model, role, difficulty) cell? */
export async function runDevReasoningBenefitCommand(options: { json?: boolean } = {}): Promise<void> {
	const observations = await readAllReasoningObservations().catch(() => []);
	// Group by cell (model × role × difficulty), then learn the benefit per cell.
	const byCell = new Map<string, typeof observations>();
	for (const obs of observations) {
		const key = `${obs.modelId}::${obs.role}::${obs.difficulty}`;
		const list = byCell.get(key) ?? [];
		list.push(obs);
		byCell.set(key, list);
	}
	const rows = [...byCell.entries()].map(([key, cellObs]) => ({ key, profile: learnReasoningBenefit(cellObs) }));
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ observations: observations.length, cells: rows }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Reasoning benefit (F3.16) — ${observations.length} A/B observation(s)\n\n`);
	if (rows.length === 0) {
		process.stdout.write(
			"(no reasoning A/B observations yet — run an eval with the enforced-reasoning probe enabled, then re-check)\n",
		);
		return;
	}
	for (const { key, profile } of rows) {
		const benefit =
			profile.benefit === null ? "n/a" : `${profile.benefit >= 0 ? "+" : ""}${(profile.benefit * 100).toFixed(0)}%`;
		process.stdout.write(
			`  ${key.padEnd(48)} ${profile.recommendation.padEnd(14)} benefit ${benefit.padStart(5)} ` +
				`[on ${profile.onSamples} · off ${profile.offSamples}]\n`,
		);
	}
}

/** Model-role stability: over recorded raw eval runs, is each (model, role) SETTLED or FLAKY (per-run quality spread)? */
export async function runDevModelRoleStabilityCommand(options: { json?: boolean } = {}): Promise<void> {
	const runs = await readAllModelEvalRuns().catch(() => []);
	const rows = summarizeModelRoleStability(runs);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ runsRecorded: runs.length, rows }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Model-role stability — ${runs.length} recorded eval run(s)\n\n`);
	if (rows.length === 0) {
		process.stdout.write("(no eval runs recorded yet — run model evals, then re-check)\n");
		return;
	}
	for (const row of rows) {
		process.stdout.write(
			`  ${row.modelId.slice(0, 38).padEnd(38)} ${row.role.padEnd(10)} ` +
				`${String(Math.round(row.settledFraction * 100)).padStart(3)}% settled  ` +
				`[settled ${row.settledCells} · flaky ${row.flakyCells} · thin ${row.thinCells} of ${row.cells} cell(s)] ` +
				`conf ${row.meanConfidence.toFixed(2)}${row.totalRunsOwed > 0 ? ` · ${row.totalRunsOwed} re-eval(s) owed` : ""}\n`,
		);
	}
}

/** §5.AB — routing calibration: join recorded routing decisions with ledger outcomes, then summarize. */
export async function runDevRoutingCalibrationCommand(options: { json?: boolean } = {}): Promise<void> {
	const [decisions, ledgerEvents] = await Promise.all([
		readAllRoutingDecisions().catch(() => []),
		readAllAgentLedger().catch(() => []),
	]);
	// Build a taskId → terminal-outcome map from the ledger (last terminal attempt wins). qualityOk maps to the
	// verifier verdict: true=pass, false=fail, null/absent=not_run.
	const outcomesByTaskId = new Map<string, RoutingOutcomeJoin>();
	for (const attempt of selectAttempts(ledgerEvents)) {
		if (!attempt.taskId) {
			continue;
		}
		outcomesByTaskId.set(attempt.taskId, {
			actualOutcome: attempt.outcome,
			verifierOutcome: attempt.qualityOk === true ? "pass" : attempt.qualityOk === false ? "fail" : "not_run",
		});
	}
	const summary = summarizeRoutingCalibration(backfillRoutingOutcomes(decisions, outcomesByTaskId));
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ ...summary, joinedOutcomes: outcomesByTaskId.size }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Routing calibration (§5.AB) — ${summary.total} recorded routing decision(s)\n\n`);
	if (summary.total === 0) {
		process.stdout.write("(no routing decisions recorded yet — start some tasks, then re-check)\n");
		return;
	}
	const rc = summary.routeTypeCounts;
	process.stdout.write(
		`  routes: assign ${rc.assign} · route_up ${rc.route_up} · decompose ${rc.decompose} · escalate ${rc.escalate}\n`,
	);
	process.stdout.write(
		`  escalation-rate ${(summary.escalationRate * 100).toFixed(0)}% · ${summary.runCount} run(s) joined · ` +
			`success ${(summary.successRate * 100).toFixed(0)}% · verifier-pass ${(summary.verifierPassRate * 100).toFixed(0)}%\n`,
	);
	const gap = summary.uncertaintyFailureGap;
	process.stdout.write(
		`  uncertainty: ${summary.meanUncertainty === null ? "not recorded (no live confidence signal yet)" : summary.meanUncertainty.toFixed(2)}` +
			`${gap === null ? "" : ` · failure-gap ${gap.toFixed(2)}`}\n`,
	);
}

/** §5.AC — is online retrieval earning its keep? Project the ledger's retrieval events into a usefulness summary. */
export async function runDevRetrievalUsefulnessCommand(options: { json?: boolean } = {}): Promise<void> {
	const events = await readAllAgentLedger();
	const summary = summarizeRetrievalUsefulness(events);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Retrieval usefulness (§5.AC) — ${summary.total} retrieval event(s) in the ledger\n\n`);
	if (summary.total === 0) {
		process.stdout.write("(no retrieval events recorded yet — run some retrieval turns, then re-check)\n");
		return;
	}
	const prune =
		summary.meanDistractorPruneRatio === null ? "n/a" : `${(summary.meanDistractorPruneRatio * 100).toFixed(0)}%`;
	process.stdout.write(
		`  helped ${summary.helped} · hurt ${summary.hurt} · neutral ${summary.neutral} · unknown ${summary.unknown}\n`,
	);
	process.stdout.write(
		`  helpful-rate ${(summary.helpfulRate * 100).toFixed(0)}% (of verdicted) · mean distractor-prune ${prune} · ` +
			`${summary.totalCitations} citation(s) across ${summary.distinctCitedSources} distinct source(s)\n`,
	);
}

/** F5.2 — run the memory freshness audit over the real ~/basic-memory corpus (stale/orphaned/broken_link/duplicate). */
export async function runDevMemoryAuditCommand(
	options: { json?: boolean; root?: string; staleDays?: number } = {},
): Promise<void> {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	const root = options.root?.trim() || join(homedir(), "basic-memory");
	const staleDays = options.staleDays && options.staleDays > 0 ? options.staleDays : 180;
	const notes = await readBasicMemoryNotes(root, nodeBasicMemoryFsDeps()).catch(() => []);
	const config = { stalenessThresholdMs: staleDays * 24 * 60 * 60 * 1000, cadenceMs: 0 };
	const result = auditMemoryFreshness(notes, config, Date.now());
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ root, staleDays, ...result }, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Memory freshness audit (F5.2) — ${result.notesAudited} note(s) at ${root} (stale > ${staleDays}d)\n\n`,
	);
	const { summary } = result;
	process.stdout.write(
		`  stale ${summary.stale} · orphaned ${summary.orphaned} · broken_link ${summary.broken_link} · duplicate_title ${summary.duplicate_title}\n\n`,
	);
	for (const finding of result.findings.slice(0, 30)) {
		process.stdout.write(`  [${finding.kind}] ${finding.noteTitle.slice(0, 48).padEnd(48)} — ${finding.detail}\n`);
	}
	if (result.findings.length > 30) {
		process.stdout.write(`  … and ${result.findings.length - 30} more\n`);
	}
}

/** memory-lifecycle (opencode-swarm port) — classify the real ~/basic-memory corpus into promote/retire/merge/keep. */
export async function runDevMemoryLifecycleCommand(options: { json?: boolean; root?: string } = {}): Promise<void> {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	const root = options.root?.trim() || join(homedir(), "basic-memory");
	const notes = await readBasicMemoryNotes(root, nodeBasicMemoryFsDeps()).catch(() => []);
	const recommendations = classifyMemoryLifecycle(notes, {}, undefined, Date.now());
	const actionable = recommendations.filter((r) => r.action !== "keep");
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ root, notesRead: notes.length, recommendations: actionable }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(`Memory lifecycle (opencode-swarm port) — ${notes.length} note(s) at ${root}\n\n`);
	const summary = { promote: 0, retire: 0, merge: 0, keep: 0 } as Record<string, number>;
	for (const rec of recommendations) {
		summary[rec.action] += 1;
	}
	process.stdout.write(
		`  promote ${summary.promote} · retire ${summary.retire} · merge ${summary.merge} · keep ${summary.keep}\n\n`,
	);
	for (const rec of actionable.slice(0, 20)) {
		process.stdout.write(`  [${rec.action}] ${rec.noteTitle.slice(0, 54).padEnd(54)} — ${rec.rationale}\n`);
	}
	if (actionable.length > 20) {
		process.stdout.write(`  … and ${actionable.length - 20} more\n`);
	}
}

/** F3.12 — project a card's real ledger lifecycle onto the outer-controller phases (orient→plan→act→verify→repair→finish). */
export async function runDevControllerTraceCommand(options: { taskId: string; json?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const transitionTos = events
		.filter((e) => e.kind === "transition" && e.taskId === options.taskId)
		.map((e) => (e as Extract<AgentLedgerEvent, { kind: "transition" }>).to);
	const trace = projectCardControllerTrace(transitionTos);
	const terminal = trace[trace.length - 1];
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ taskId: options.taskId, trace, terminal: terminal ?? null }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(`Controller trace (F3.12) for ${options.taskId}\n\n`);
	if (trace.length === 0) {
		process.stdout.write("(no controller-relevant transitions recorded for this task)\n");
		return;
	}
	process.stdout.write(`  ${trace.join(" → ")}\n`);
	const repairs = trace.filter((p) => p === "repair").length;
	process.stdout.write(
		`\n  terminal: ${terminal ?? "in-progress"}${repairs > 0 ? ` · ${repairs} repair cycle(s)` : ""}\n`,
	);
}

/** F3.33 — preview the confidence+resource-aware routing order for a role over the LOADED fleet (verifiable live). */
export async function runDevRoutingPreviewCommand(options: { role: string; json?: boolean }): Promise<void> {
	const advice = buildModelCapabilityAdvice(await readAllAgentLedger());
	const loaded = (await fetchLmsPsModels(createDefaultLmsRunner()).catch(() => [])).filter((m) => !m.isEmbedding);
	const roleFitness = advice.perRole.filter((r) => r.role === options.role);
	// §5.AB live sweep consumption (2026-07-17): mirror the router's evidence order — real-task ledger role evidence
	// first, then the fitness table's swept role cells (so a freshly-swept model previews above the neutral prior,
	// matching what routeNKleinTask now does via the capability blender's fitness tier).
	const { buildFitnessRoutingEvidence, stableFitnessModelKey } = await import("../core/fitness-routing-evidence");
	const { roleEvidenceKey } = await import("../core/ledger-evidence");
	const { readFitnessTable } = await import("../telemetry/fitness-table-store");
	const fitnessEvidence = buildFitnessRoutingEvidence(
		Object.values((await readFitnessTable().catch(() => null))?.rows ?? {}),
	);
	const confidenceFor = (m: { identifier: string; modelKey: string }): number => {
		const hit = roleFitness.find((r) => r.modelId.includes(m.identifier) || r.modelId.includes(m.modelKey));
		if (hit) {
			return hit.successRate;
		}
		const swept = fitnessEvidence.fitnessRoleSuccessByKey.get(
			roleEvidenceKey(stableFitnessModelKey(m.identifier), options.role),
		);
		return swept && swept.samples >= 3 ? swept.successRate : 0.5; // unknown ⇒ neutral prior
	};
	// A loaded model is feasible by definition (it already fits in RAM) and warm (no cold load).
	const candidates: RoutingCandidate[] = loaded.map((m) => ({
		modelKey: m.identifier,
		endpoint: m.machineId,
		qualityConfidence: confidenceFor(m),
		queueDepth: m.queued,
		freeRamGb: 1,
		requiredRamGb: 0,
		estimatedLoadMs: 0,
		endpointOccupancy: m.queued > 0 ? Math.min(1, m.queued / 4) : 0,
		warmCacheValue: 0.5,
	}));
	const ranked = rankRoutingCandidates(candidates);

	if (options.json) {
		process.stdout.write(`${JSON.stringify({ role: options.role, ranking: ranked }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Routing preview (F3.33) for role "${options.role}" over the loaded fleet — best first\n\n`);
	if (ranked.length === 0) {
		process.stdout.write("(no non-embedding models loaded)\n");
		return;
	}
	for (const r of ranked) {
		const reasons = r.reasons.length > 0 ? ` — ${r.reasons.join(", ")}` : "";
		process.stdout.write(
			`  ${String(Math.round(r.score * 100)).padStart(3)}  ${r.modelKey.padEnd(38)} @${r.endpoint}${reasons}\n`,
		);
	}
}

/** F3.29 — assess a task's stubborn-failure state from its real ledger attempts (exhausted? best partial? park report?). */
export async function runDevStubbornFailureCommand(options: { taskId: string; json?: boolean }): Promise<void> {
	const events = await readAllAgentLedger();
	const attempts: EscalationAttempt[] = events
		.filter(
			(e): e is Extract<AgentLedgerEvent, { kind: "attempt" }> =>
				e.kind === "attempt" && e.taskId === options.taskId,
		)
		.map((a) => ({
			attemptId: a.attemptId,
			modelId: a.modelId,
			approach: a.promptStrategy ?? "default",
			outcome: a.outcome === "success" ? "success" : "failure",
			qualityScore: a.qualityScore,
			artifactRef: a.artifacts?.resultBranch ?? null,
		}));
	const verdict = assessStubbornFailure(attempts);
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ taskId: options.taskId, attempts: attempts.length, verdict }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(
		`Stubborn-failure assessment (F3.29) for ${options.taskId} — ${attempts.length} attempt(s)\n\n`,
	);
	process.stdout.write(`  status: ${verdict.status}\n`);
	process.stdout.write(
		`  remaining budget: ${verdict.remaining.models} model(s), ${verdict.remaining.approaches} approach(es), ${verdict.remaining.attempts} attempt(s)\n`,
	);
	if (verdict.bestPartial) {
		process.stdout.write(
			`  best partial: ${verdict.bestPartial.modelId} via "${verdict.bestPartial.approach}" (quality ${verdict.bestPartial.qualityScore ?? 0}) ${verdict.bestPartial.artifactRef ?? "(no artifact)"}\n`,
		);
	}
	if (verdict.evidenceReport) {
		process.stdout.write(`\n${verdict.evidenceReport}\n`);
	}
}

export async function runDevEscalationCommand(options: {
	taskId: string;
	json?: boolean;
	analyze?: boolean;
}): Promise<void> {
	const events = await readAllAgentLedger();
	const report = buildTaskEscalationReport(events, options.taskId);
	// §5.AB: the user-chosen "make a bigger model available to analyze + guide" option — print the analysis prompt.
	if (options.analyze) {
		const request = buildStuckTaskAnalysisRequest(report);
		process.stdout.write(`# ${request.title}\n\n${request.prompt}\n`);
		return;
	}
	// §5.AB: the progress verdict over the same ledger. `hard_stuck` means the AUTOMATIC ladder (all approaches × all
	// loaded models) is exhausted → escalate to the user with the "get through the wall" suggestions.
	const signals = buildStucknessSignalsFromLedger(events, options.taskId);
	const stuckness = classifyAgentStuckness(signals);
	const suggestions = isHardStuck(signals) ? buildEscalationSuggestions() : [];
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ report, stuckness, suggestions }, null, 2)}\n`);
		return;
	}
	if (report.totalAttempts === 0) {
		process.stdout.write(`No attempts recorded for task "${options.taskId}" yet.\n`);
		return;
	}
	process.stdout.write(
		`Escalation report — task ${report.taskId}\n` +
			`  ${report.totalAttempts} attempt(s) · models tried: ${report.modelsTried.join(", ")} · final: ${report.finalOutcome}\n\n`,
	);
	for (const row of report.attempts) {
		const quality = row.qualityScore !== null ? ` q=${row.qualityScore.toFixed(2)}` : "";
		const salvage = row.salvage ? ` salvage=${row.salvage}` : "";
		process.stdout.write(
			`  rung ${String(row.rung).padStart(2)}  ${row.modelId.padEnd(36)} ${row.approach.padEnd(28)} → ${row.outcome}${quality}${salvage}\n`,
		);
	}
	process.stdout.write(`\n  Progress verdict: ${stuckness}\n`);
	if (suggestions.length > 0) {
		process.stdout.write(
			"  Automatic recovery exhausted — escalate to the user. Suggestions to get through the wall:\n",
		);
		for (const suggestion of suggestions) {
			process.stdout.write(`    • ${suggestion.title} — ${suggestion.detail}\n`);
		}
	}
}

export async function runDevRailEvidenceCommand(options: {
	json?: boolean;
	advisor?: boolean;
	findings?: boolean;
	retain?: boolean;
}): Promise<void> {
	const reports = await readRailEvidenceReports();
	// F1.33b: the findings mount — classify the harvested reports into typed findings + propose-only backlog packages,
	// optionally retaining each finding to the ledger (F1.26-style latest-wins) with --retain.
	if (options.findings || options.retain) {
		const report = classifyRailFindings(reports);
		const proposals = proposeRailBacklogPackages(report.findings);
		if (options.retain) {
			const workspacePathHash = hashWorkspacePathForLedger(process.cwd());
			for (const finding of report.findings) {
				await appendAgentLedgerEvent(buildRailFindingRetentionEvent({ workspacePathHash, finding }));
			}
		}
		if (options.json) {
			process.stdout.write(
				`${JSON.stringify({ findings: report.findings, proposals, retained: options.retain ? report.findings.length : 0 }, null, 2)}\n`,
			);
			return;
		}
		process.stdout.write(formatRailFindingsReport(report, proposals));
		if (options.retain && report.findings.length > 0) {
			process.stdout.write(`\nRetained ${report.findings.length} finding(s) to the ledger.\n`);
		}
		return;
	}
	const aggregate = aggregateRailEvidence(reports);
	if (options.advisor) {
		const request = buildRailEvidenceAnalysisPrompt(aggregate);
		process.stdout.write(`# ${request.title}\n\n${request.prompt}\n`);
		return;
	}
	if (options.json) {
		process.stdout.write(`${JSON.stringify(aggregate, null, 2)}\n`);
		return;
	}
	process.stdout.write(
		`Dev-test rail evidence — ${aggregate.totalRuns} run(s) across ${aggregate.totalReports} report(s)` +
			(aggregate.models.length > 0 ? ` · models: ${aggregate.models.join(", ")}` : "") +
			"\n\n",
	);
	if (aggregate.byProject.length === 0) {
		process.stdout.write("(no rail evidence harvested yet — run scripts/dev-test-rail.mts, then re-check)\n");
		return;
	}
	process.stdout.write("Per-project (worst delivery first):\n");
	for (const project of aggregate.byProject) {
		const flags = [
			project.failedToStart > 0 ? `start-fail×${project.failedToStart}` : "",
			project.failed > 0 ? `fail×${project.failed}` : "",
			project.nonTerminal > 0 ? `nonterm×${project.nonTerminal}` : "",
			project.anomalyRuns > 0 ? `anomaly×${project.anomalyRuns}` : "",
		]
			.filter((flag) => flag.length > 0)
			.join(" ");
		process.stdout.write(
			`  ${project.project.padEnd(16)} ${project.delivered}/${project.runs} delivered  ` +
				`${String(Math.round(project.deliveryRate * 100)).padStart(3)}%  ${flags}\n`,
		);
	}
}

async function readLedgerCapture(path: string): Promise<AgentLedgerEvent[]> {
	const raw = await readFile(path, "utf8");
	return parseValidatedJsonl(raw, agentLedgerEventSchema, "replay-eval-capture");
}

/**
 * F1.26b — the replay-eval CLI mount (first mount): compare a captured baseline ledger against a replayed
 * (patched-tree) ledger with the shipped §5.AF determinism comparator, print the verdict, and (with --retain) retain
 * it to the ledger so the M4 gate reads it back. This mounts the COMPARISON over two provided captures; the auto-CAPTURE
 * (apply the result branch to a temp worktree + run the aimock dev-test suite twice) is the follow-up effectful half.
 */
export async function runDevReplayEvalCommand(options: {
	taskId: string;
	baseline: string;
	replay: string;
	retain?: boolean;
	json?: boolean;
}): Promise<void> {
	const [captured, replayed] = await Promise.all([
		readLedgerCapture(options.baseline),
		readLedgerCapture(options.replay),
	]);
	const outcome = buildReplayEvalOutcome({
		captured,
		replayed,
		workflowId: "self-improvement-replay",
		taskId: options.taskId,
		workspacePathHash: hashWorkspacePathForLedger(process.cwd()),
	});
	if (options.retain) {
		await appendAgentLedgerEvent(outcome.retentionEvent);
	}
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ evaluation: outcome.evaluation, retained: Boolean(options.retain) }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(
		`Replay-eval for ${options.taskId}: ${outcome.evaluation.pass ? "PASS" : "FAIL"} — ${outcome.evaluation.summary}\n` +
			(options.retain ? "Retained the verdict to the ledger (the M4 gate reads it back).\n" : ""),
	);
}

/**
 * F1.26b — the replay-eval AUTO-CAPTURE mount (`nklein dev replay-eval <taskId>` with no `--baseline/--replay`): rather
 * than hand-supplied ledgers, PRODUCE both captures by running the deterministic simulated dev-test suite twice — once
 * on the current tree (baseline) and once on the task's result-branch worktree (replay) — then compare + optionally
 * retain via the shipped `orchestrateReplayEvalAutoCapture`. Composes the three live effectful primitives: the
 * `verify-simulated-flow` harness (`runScenarioSuite`), the throwaway git worktree (`createResultWorktree`), and the
 * isolated-dir ledger read (`readAgentLedger`). Deterministic (no live models) but heavy — each pass boots a runtime and
 * drains the suite. Isolated capture dirs keep the two ledgers apart; the worktree is always cleaned up.
 */
export async function runDevReplayEvalAutoCaptureCommand(options: {
	taskId: string;
	retain?: boolean;
	json?: boolean;
}): Promise<void> {
	const repoPath = process.cwd();
	const captureRoot = await mkdtemp(join(tmpdir(), "nklein-replay-caps-"));
	const outcome = await orchestrateReplayEvalAutoCapture(
		{
			taskId: options.taskId,
			resultBranch: createTaskResultBranchRef(options.taskId),
			baselineTreePath: repoPath,
			workflowId: "self-improvement-replay",
			workspacePathHash: hashWorkspacePathForLedger(repoPath),
			baselineLedgerRoot: join(captureRoot, "baseline"),
			replayLedgerRoot: join(captureRoot, "replay"),
		},
		{
			// The baseline runs from the current repo (has node_modules); the worktree borrows them via nodeModulesFrom.
			runScenarioSuite: ({ treePath, ledgerRootDir }) =>
				runScenarioSuite({ treePath, ledgerRootDir, nodeModulesFrom: repoPath }),
			createResultWorktree: (resultBranch) => createResultWorktree({ repoPath, resultBranch }),
			readCapturedLedger: ({ ledgerRootDir, workspacePathHash }) =>
				readAgentLedger({ workspacePathHash, rootDir: ledgerRootDir }),
		},
	);
	if (options.retain) {
		await appendAgentLedgerEvent(outcome.retentionEvent);
	}
	if (options.json) {
		process.stdout.write(
			`${JSON.stringify({ evaluation: outcome.evaluation, retained: Boolean(options.retain) }, null, 2)}\n`,
		);
		return;
	}
	process.stdout.write(
		`Replay-eval (auto-capture) for ${options.taskId}: ${outcome.evaluation.pass ? "PASS" : "FAIL"} — ${outcome.evaluation.summary}\n` +
			(options.retain ? "Retained the verdict to the ledger (the M4 gate reads it back).\n" : ""),
	);
}

export async function runDevRostersCommand(options: { json?: boolean } = {}): Promise<void> {
	// Prefer the user's real fleet (~/.nklein/swarm-rosters.json) when present; else the shipped example presets.
	const userConfig = await loadUserSwarmConfig();
	const rosters = resolveEffectiveRosters(userConfig);
	const budgets = resolveEffectiveBudgets(userConfig);
	if (options.json) {
		const payload = rosters.map((roster) => ({ roster, fit: assessRosterFit(roster, budgets) }));
		process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
		return;
	}
	for (const roster of rosters) {
		process.stdout.write(`${formatSwarmRosterReport(roster, budgets)}\n\n`);
	}
}

/**
 * F12.79/F12.80 — lint a rules / prompt file for instruction bloat and bare prohibitions. Reads the file, runs the pure
 * `lintPromptFragment` heuristics, and prints the instruction-budget verdict + any bare "don't/never/avoid" prohibitions.
 * Useful for keeping AGENTS.md / CLAUDE.md / assembled agent prompts within a small model's instruction-following budget.
 */
export async function runDevPromptLintCommand(options: {
	file: string;
	modelSizeB?: number;
	cap?: number;
	json?: boolean;
}): Promise<void> {
	const { readFile } = await import("node:fs/promises");
	const text = await readFile(options.file, "utf8").catch((err: unknown) => {
		process.stdout.write(`Could not read ${options.file}: ${err instanceof Error ? err.message : String(err)}\n`);
		return null;
	});
	if (text === null) {
		return;
	}
	const lintOptions = {
		...(typeof options.modelSizeB === "number" ? { modelSizeB: options.modelSizeB } : {}),
		...(typeof options.cap === "number" ? { cap: options.cap } : {}),
	};
	const lint = lintPromptFragment(text, lintOptions);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ file: options.file, ...lint }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Prompt-fragment lint (F12.79/F12.80) — ${options.file}\n\n`);
	process.stdout.write(`  Instruction budget: ${lint.budget.advice}\n`);
	process.stdout.write(`  Prohibitions: ${lint.prohibitions.advice}\n`);
	const bare = lint.prohibitions.findings.filter((f) => !f.hasAlternative);
	if (bare.length > 0) {
		process.stdout.write(`\n  Bare prohibitions (rephrase positively or pair with a concrete alternative):\n`);
		for (const finding of bare.slice(0, 20)) {
			process.stdout.write(`    • ${finding.text.slice(0, 96)}\n`);
		}
		if (bare.length > 20) {
			process.stdout.write(`    … and ${bare.length - 20} more\n`);
		}
	}
	process.stdout.write(`\n  ${lint.hasWarnings ? "⚠ warnings present" : "✓ clean"}\n`);
}

/**
 * F12.42 — score every ledger attempt's PROCESS quality (Ideal/Solid/Lucky) and roll up per model. Surfaces the lucky-win
 * rate: a model with a strong resolve rate but many brittle (lucky) wins is over-credited by pass/fail alone.
 */
export async function runDevTrajectoryQualityCommand(options: { json?: boolean } = {}): Promise<void> {
	const { summarizeTrajectoryQualityFromLedger } = await import("../core/trajectory-quality-projection");
	const events = await readAllAgentLedger();
	const result = summarizeTrajectoryQualityFromLedger(events);
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Trajectory quality (F12.42) — ${result.overall.total} attempt(s) in the ledger\n\n`);
	if (result.overall.total === 0) {
		process.stdout.write("(no attempts recorded yet — run some tasks/fleet evals to populate the ledger)\n");
		return;
	}
	const o = result.overall;
	process.stdout.write(
		`  overall: ideal ${o.ideal} · solid ${o.solid} · lucky ${o.lucky} · failed ${o.failed} — lucky-win rate ${(o.luckyWinRate * 100).toFixed(0)}%\n\n`,
	);
	for (const { modelId, summary } of result.perModel.slice(0, 20)) {
		process.stdout.write(
			`  ${modelId.slice(0, 46).padEnd(46)} n=${String(summary.total).padStart(3)} ` +
				`I/S/L/F ${summary.ideal}/${summary.solid}/${summary.lucky}/${summary.failed} ` +
				`lucky-win ${(summary.luckyWinRate * 100).toFixed(0)}%\n`,
		);
	}
	if (result.perModel.length > 20) {
		process.stdout.write(`  … and ${result.perModel.length - 20} more models\n`);
	}
}

/**
 * F12.48 — per-(model, role) cost-per-resolve + the Pareto frontier over the persisted attempt ledger. Cost only
 * means something divided by delivered outcomes; the frontier names the models NOT dominated per role.
 */
export async function runDevCostPerResolveCommand(options: { json?: boolean } = {}): Promise<void> {
	const { computeCostPerResolve, paretoFrontierOf } = await import("../core/cost-per-resolve");
	const events = await readAllAgentLedger();
	const rows = computeCostPerResolve(events);
	const frontier = paretoFrontierOf(rows);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ rows, frontier }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Cost per resolve (F12.48) — ${rows.length} model×role row(s)\n\n`);
	if (rows.length === 0) {
		process.stdout.write("(no attempts in the ledger yet)\n");
		return;
	}
	const frontierKeys = new Set(frontier.map((row) => `${row.modelId} ${row.role}`));
	for (const row of rows.slice(0, 24)) {
		const mark = frontierKeys.has(`${row.modelId} ${row.role}`) ? "★" : " ";
		const cost =
			row.wallMsPerResolve === null ? "      —" : `${(row.wallMsPerResolve / 1000).toFixed(0).padStart(5)}s`;
		const tokens =
			row.tokensPerResolve === null ? "     —" : `${(row.tokensPerResolve / 1000).toFixed(0).padStart(4)}kT`;
		process.stdout.write(
			`  ${mark} ${row.modelId.slice(0, 42).padEnd(44)} ${row.role.padEnd(10)} rate ${(row.resolveRate * 100).toFixed(0).padStart(3)}%  ${cost}/resolve  ${tokens}/resolve  (n=${row.attempts})\n`,
		);
	}
	process.stdout.write(`\n  ★ = Pareto frontier for its role (not dominated on accuracy vs wall-cost)\n`);
}

/**
 * F12.99 — inspect + verify the local hash-chained egress-receipt log (the trust-center's auditable record of every
 * outbound request). --verify recomputes the whole chain and reports the first break.
 */
export async function runDevEgressReceiptsCommand(options: { json?: boolean; verify?: boolean } = {}): Promise<void> {
	const { readEgressReceipts } = await import("../state/egress-receipt-store");
	const { verifyEgressReceiptChain } = await import("../core/egress-receipt");
	const receipts = await readEgressReceipts();
	const verification = verifyEgressReceiptChain(receipts);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ receipts, verification }, null, 2)}\n`);
		return;
	}
	process.stdout.write(`Egress receipts (F12.99) — ${receipts.length} receipt(s)\n\n`);
	for (const receipt of receipts.slice(-20)) {
		const when = new Date(receipt.at).toISOString();
		process.stdout.write(`  ${when}  [${receipt.category}] ${receipt.method} ${receipt.destination.slice(0, 90)}\n`);
	}
	if (receipts.length === 0) {
		process.stdout.write("  (no outbound requests recorded — the log fills when an egress class fires)\n");
	}
	process.stdout.write(
		`\n  chain: ${verification.valid ? "INTACT" : `BROKEN at #${verification.brokenAt}`} — ${verification.reason}\n`,
	);
}
