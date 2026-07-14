import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import { classifyRailDeliveryTrend, type RailDeliveryTrendReport } from "./rail-delivery-trend.js";
import { aggregateRailEvidence, type RailEvidenceAggregate, type RailEvidenceReport } from "./rail-evidence.js";

/**
 * F1.33 (§5.AI) — auto-analyse harvested rail evidence into TYPED FINDINGS, and turn those into deduplicated
 * backlog-package PROPOSALS for human review. This is the second half of "auto-collect → feed the todos": the
 * aggregation (per-project scorecard) and the delivery trend (regressing / newly-broken) already exist; this
 * module classifies them into the four F1.33 finding kinds, retains them as ledger evidence, and drafts the
 * backlog packages — PROPOSE-ONLY by design (a human moves a proposal into todo.md; the rail never writes the
 * backlog itself).
 *
 * Finding kinds:
 *   - `regression`  — the scenario's delivery trend is `regressing` (severity HIGH when `newlyBroken`: it
 *     delivered in the baseline window and in none of the recent runs);
 *   - `flake`       — mixed outcomes with NO direction: enough runs, delivery strictly between 0 and 1, and the
 *     trend came back `stable` (a real slide is a regression, not a flake);
 *   - `quality_gap` — the scenario DELIVERS (rate at/above the floor) but with anomaly runs (narration leaks /
 *     hot repeats) — working, but not cleanly;
 *   - `idea`        — start-failure-dominated scenarios (the run never launched): evidence of harness/env work
 *     rather than model capability, proposed as an investigation idea.
 *
 * Pure + deterministic (thresholds injectable, stable ordering, ids are the dedup keys); the ledger builder and
 * reader follow the F1.26 retention pattern (a `transition` event with a dedicated controllerDecision, latest
 * write per finding id wins).
 */

export type RailFindingKind = "regression" | "flake" | "quality_gap" | "idea";
export type RailFindingSeverity = "high" | "medium" | "low";

export interface RailFinding {
	/** Stable dedup key: `<kind>:<project>`. */
	id: string;
	kind: RailFindingKind;
	project: string;
	severity: RailFindingSeverity;
	summary: string;
	evidence: {
		runs: number;
		deliveryRate: number;
		delta: number | null;
		newlyBroken: boolean;
		anomalyRuns: number;
		failedToStart: number;
	};
}

export interface RailFindingsThresholds {
	/** Minimum total runs before a mixed-outcome scenario can be called a flake. Default 4. */
	minRunsForFlake?: number;
	/** Delivery-rate floor at/above which anomaly runs read as a quality gap (not a delivery problem). Default 0.8. */
	qualityDeliveryFloor?: number;
	/** Share of runs that failed to start at/above which the scenario becomes an `idea` finding. Default 0.5. */
	startFailureShareFloor?: number;
}

export interface RailFindingsReport {
	findings: readonly RailFinding[];
	trend: RailDeliveryTrendReport;
	aggregate: RailEvidenceAggregate;
}

const SEVERITY_ORDER: Record<RailFindingSeverity, number> = { high: 0, medium: 1, low: 2 };
const KIND_ORDER: Record<RailFindingKind, number> = { regression: 0, flake: 1, quality_gap: 2, idea: 3 };

function pct(rate: number): string {
	return `${Math.round(rate * 100)}%`;
}

/** Classify harvested rail reports into typed findings (ordered most-severe first; ids are stable dedup keys). */
export function classifyRailFindings(
	reports: readonly RailEvidenceReport[],
	thresholds: RailFindingsThresholds = {},
): RailFindingsReport {
	const minRunsForFlake = Math.max(2, Math.trunc(thresholds.minRunsForFlake ?? 4));
	const qualityDeliveryFloor = Math.min(1, Math.max(0, thresholds.qualityDeliveryFloor ?? 0.8));
	const startFailureShareFloor = Math.min(1, Math.max(0, thresholds.startFailureShareFloor ?? 0.5));

	const aggregate = aggregateRailEvidence(reports);
	const trend = classifyRailDeliveryTrend({ reports });
	const trendByProject = new Map(trend.byProject.map((scenario) => [scenario.project, scenario]));

	const findings: RailFinding[] = [];
	for (const project of aggregate.byProject) {
		const scenario = trendByProject.get(project.project) ?? null;
		const evidence: RailFinding["evidence"] = {
			runs: project.runs,
			deliveryRate: project.deliveryRate,
			delta: scenario && scenario.direction !== "insufficient_data" ? scenario.delta : null,
			newlyBroken: scenario?.newlyBroken ?? false,
			anomalyRuns: project.anomalyRuns,
			failedToStart: project.failedToStart,
		};

		if (scenario?.direction === "regressing") {
			findings.push({
				id: `regression:${project.project}`,
				kind: "regression",
				project: project.project,
				severity: scenario.newlyBroken ? "high" : "medium",
				summary: scenario.newlyBroken
					? `${project.project} delivered before (${pct(scenario.baselineDeliveryRate)} baseline) and delivers in NONE of the ${scenario.recentRuns} recent runs.`
					: `${project.project} delivery fell ${pct(Math.abs(scenario.delta))} (${pct(scenario.baselineDeliveryRate)} → ${pct(scenario.recentDeliveryRate)}).`,
				evidence,
			});
		} else if (
			scenario?.direction === "stable" &&
			project.runs >= minRunsForFlake &&
			project.deliveryRate > 0 &&
			project.deliveryRate < 1
		) {
			findings.push({
				id: `flake:${project.project}`,
				kind: "flake",
				project: project.project,
				severity: "medium",
				summary: `${project.project} alternates outcomes with no direction: ${project.delivered}/${project.runs} delivered (${pct(project.deliveryRate)}) and the trend is stable.`,
				evidence,
			});
		}

		if (project.deliveryRate >= qualityDeliveryFloor && project.anomalyRuns > 0) {
			findings.push({
				id: `quality_gap:${project.project}`,
				kind: "quality_gap",
				project: project.project,
				severity: project.anomalyRuns * 2 >= project.runs ? "medium" : "low",
				summary: `${project.project} delivers (${pct(project.deliveryRate)}) but ${project.anomalyRuns}/${project.runs} runs showed anomalies (${project.totalNarrationLeaks} narration leaks, ${project.totalHotRepeats} hot repeats).`,
				evidence,
			});
		}

		if (project.runs > 0 && project.failedToStart / project.runs >= startFailureShareFloor) {
			findings.push({
				id: `idea:${project.project}`,
				kind: "idea",
				project: project.project,
				severity: "medium",
				summary: `${project.project} fails to START in ${project.failedToStart}/${project.runs} runs — harness/env investigation, not model capability.`,
				evidence,
			});
		}
	}

	findings.sort((left, right) => {
		const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
		if (bySeverity !== 0) {
			return bySeverity;
		}
		const byKind = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
		if (byKind !== 0) {
			return byKind;
		}
		return left.project.localeCompare(right.project);
	});

	return { findings, trend, aggregate };
}

export const RAIL_FINDING_DECISION = "rail_analysis";
export const RAIL_FINDING_WORKFLOW_ID = "background-eval-rail";

/**
 * Retain one finding as ledger evidence — a `transition` event keyed by the finding id (`taskId`), following the
 * F1.26 retention pattern: a later event for the same finding id supersedes on read.
 */
export function buildRailFindingRetentionEvent(input: {
	workspacePathHash: string;
	finding: RailFinding;
	recordedAt?: number;
}): AgentTransitionEvent {
	return buildTransitionEvent({
		workflowId: RAIL_FINDING_WORKFLOW_ID,
		taskId: input.finding.id,
		workspacePathHash: input.workspacePathHash,
		from: "rail_evidence",
		to: `rail_finding_${input.finding.kind}`,
		reason: `${input.finding.severity}: ${input.finding.summary}`.slice(0, 900),
		controllerDecision: RAIL_FINDING_DECISION,
		...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {}),
	});
}

/** The LATEST retained rail-finding events per finding id (the read half of the retention pattern). */
export function readRetainedRailFindingEvents(events: readonly AgentLedgerEvent[]): AgentTransitionEvent[] {
	const latestById = new Map<string, AgentTransitionEvent>();
	for (const event of events) {
		if (event.kind !== "transition" || event.controllerDecision !== RAIL_FINDING_DECISION) {
			continue;
		}
		const existing = latestById.get(event.taskId);
		if (!existing || event.recordedAt >= existing.recordedAt) {
			latestById.set(event.taskId, event);
		}
	}
	return [...latestById.values()].sort((left, right) => left.taskId.localeCompare(right.taskId));
}

export interface RailBacklogProposal {
	/** Stable dedup key: `rail:<project>`. */
	proposalId: string;
	project: string;
	/** Highest severity among the bundled findings. */
	severity: RailFindingSeverity;
	title: string;
	/** One line per bundled finding (most severe first). */
	detail: string;
	findingIds: readonly string[];
}

/**
 * Draft ONE backlog-package proposal per project from its findings, deduplicated against proposals that already
 * exist (by `proposalId`) so re-running the analysis never re-proposes known work. PROPOSE-ONLY: the caller shows
 * these for human review; nothing writes todo.md.
 */
export function proposeRailBacklogPackages(
	findings: readonly RailFinding[],
	existingProposalIds: ReadonlySet<string> = new Set(),
): RailBacklogProposal[] {
	const byProject = new Map<string, RailFinding[]>();
	for (const finding of findings) {
		const bucket = byProject.get(finding.project);
		if (bucket) {
			bucket.push(finding);
		} else {
			byProject.set(finding.project, [finding]);
		}
	}

	const proposals: RailBacklogProposal[] = [];
	for (const [project, projectFindings] of byProject) {
		const proposalId = `rail:${project}`;
		if (existingProposalIds.has(proposalId)) {
			continue;
		}
		const severity = projectFindings.reduce<RailFindingSeverity>(
			(worst, finding) => (SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[worst] ? finding.severity : worst),
			"low",
		);
		const kinds = [...new Set(projectFindings.map((finding) => finding.kind))];
		proposals.push({
			proposalId,
			project,
			severity,
			title: `Rail: investigate ${project} (${kinds.join(", ")})`,
			detail: projectFindings.map((finding) => `- [${finding.severity}] ${finding.summary}`).join("\n"),
			findingIds: projectFindings.map((finding) => finding.id),
		});
	}

	proposals.sort((left, right) => {
		const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
		return bySeverity !== 0 ? bySeverity : left.project.localeCompare(right.project);
	});
	return proposals;
}

/**
 * F1.33b — human-readable rail-findings report for the `nklein dev rail-evidence --findings` CLI mount: the typed
 * findings (most-severe first) then the propose-only backlog packages. Pure; the command supplies the classified
 * report + proposals. Returns a "no findings" line when the rail is clean, so the mount always prints something.
 */
export function formatRailFindingsReport(
	report: RailFindingsReport,
	proposals: readonly RailBacklogProposal[],
): string {
	if (report.findings.length === 0) {
		return "Rail findings — none (no regressions, flakes, quality gaps, or ideas in the harvested evidence).\n";
	}
	const lines: string[] = [`Rail findings — ${report.findings.length} (most severe first):`];
	for (const finding of report.findings) {
		lines.push(
			`  [${finding.severity}] ${finding.kind.padEnd(11)} ${finding.project.padEnd(16)} ${finding.summary}` +
				` (${finding.evidence.runs} run(s), ${pct(finding.evidence.deliveryRate)} delivered${finding.evidence.newlyBroken ? ", newly-broken" : ""})`,
		);
	}
	if (proposals.length > 0) {
		lines.push("", `Proposed backlog packages (${proposals.length}, propose-only — nothing writes todo.md):`);
		for (const proposal of proposals) {
			lines.push(
				`  [${proposal.severity}] ${proposal.title}`,
				...proposal.detail.split("\n").map((line) => `    ${line}`),
			);
		}
	}
	return `${lines.join("\n")}\n`;
}
