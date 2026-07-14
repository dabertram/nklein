import { readFile } from "node:fs/promises";
import {
	type AgentLedgerEvent,
	agentLedgerEventSchema,
	buildTaskEscalationReport,
	selectAttempts,
} from "../core/agent-attempt-ledger";
import { renderSwarmEfficiencyReport, summarizeSwarmEfficiency } from "../core/agent-ledger-efficiency";
import {
	buildModelCapabilityAdvice,
	buildStucknessSignalsFromLedger,
	rankModelsByLedgerFitnessWithVerdict,
	summarizeLedgerForDisplay,
} from "../core/agent-ledger-projections";
import { classifyAgentStuckness, isHardStuck } from "../core/agent-stuckness";
import { buildEscalationSuggestions } from "../core/escalation-suggestions";
import { buildLedgerEvidence } from "../core/ledger-evidence";
import { fetchLmsLinkDevices } from "../core/lms-link-status";
import { createDefaultLmsRunner, fetchLmsPsModels, LOCAL_MACHINE_ID } from "../core/lms-ps-json";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import {
	dominantFailureMode,
	learnedQualityEffectiveBudget,
	learnedRetryBudget,
	preferredToolCallFormat,
} from "../core/model-behavior-profile";
import { lookupModelCapability } from "../core/model-capability-catalog";
import { adviseModelFleet } from "../core/model-fleet-advisor";
import { aggregateRailEvidence, buildRailEvidenceAnalysisPrompt } from "../core/rail-evidence";
import {
	buildRailFindingRetentionEvent,
	classifyRailFindings,
	formatRailFindingsReport,
	proposeRailBacklogPackages,
} from "../core/rail-findings";
import { buildReplayEvalOutcome } from "../core/replay-eval-orchestration";
import {
	assessRuntimeModelVerdict,
	combineSuitabilityVerdicts,
	type RuntimeRunOutcome,
} from "../core/runtime-model-verdict";
import { buildStuckTaskAnalysisRequest } from "../core/stuck-task-analysis";
import { assessRosterFit, formatSwarmRosterReport } from "../core/swarm-roster";
import { loadUserSwarmConfig, resolveEffectiveBudgets, resolveEffectiveRosters } from "../core/swarm-roster-config";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { buildSwarmMachineView, formatSwarmMachineView } from "../nklein-agent/nklein-swarm-view";
import { appendAgentLedgerEvent, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { parseValidatedJsonl } from "../state/jsonl-store";
import { readRailEvidenceReports } from "../state/rail-evidence-store";
import { readSelfObservationEvents } from "../telemetry/self-observation-sink";

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
