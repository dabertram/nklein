import {
	assessCapabilityCeiling,
	type CapabilityCeilingVerdict,
	ceilingHitRoles,
	type FleetModelFitness,
	type RoleQualityBar,
} from "@runtime-capability-ceiling";
import {
	type EvalCellFreshnessInput,
	type EvalCellReevaluationScore,
	rankEvalCellsForReevaluation,
} from "@runtime-eval-freshness";
import { BarChart3, FlaskConical, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
	evaluateConnectedModels,
	fetchFitnessTable,
	fetchKnowledgeToolUsageStats,
	fetchModelBehaviorProfiles,
	fetchModelPerformanceStats,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeDecompositionKnowledgeUsageAggregate,
	RuntimeEvaluateConnectedModelsResponse,
	RuntimeFitnessTableResponse,
	RuntimeKnowledgeToolUsageAggregate,
	RuntimeKnowledgeToolUsageObservation,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeModelBehaviorProfilesResponse,
	RuntimeModelPerformanceAggregate,
	RuntimeModelPerformanceObservation,
	RuntimeModelPerformanceStatsResponse,
} from "@/runtime/types";

interface ModelPerformanceStatsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
}

function formatPercent(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "n/a";
	}
	return `${Math.round(value * 100)}%`;
}

// F2.22: color the confidence band so a glance separates well-evidenced cells (green/high) from thin ones
// (tertiary/none), matching the app's status palette.
function fitnessBandClassName(band: "none" | "low" | "medium" | "high"): string {
	if (band === "high") {
		return "text-status-green";
	}
	if (band === "medium") {
		return "text-status-blue";
	}
	if (band === "low") {
		return "text-status-orange";
	}
	return "text-text-tertiary";
}

function formatDuration(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "n/a";
	}
	if (value < 1000) {
		return `${Math.round(value)} ms`;
	}
	const seconds = value / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)} s`;
	}
	const minutes = seconds / 60;
	return `${minutes.toFixed(1)} min`;
}

function formatNumber(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "n/a";
	}
	return Math.round(value).toLocaleString();
}

function formatTimestamp(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "n/a";
	}
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function formatModel(record: Pick<RuntimeModelPerformanceAggregate, "providerId" | "modelId">): string {
	const provider = record.providerId ?? "unknown";
	const model = record.modelId ?? "unknown";
	return `${provider} / ${model}`;
}

function aggregateSortValue(aggregate: { scope: "overall" | "project" | "version" | "model" }): number {
	if (aggregate.scope === "project") {
		return 3;
	}
	if (aggregate.scope === "version") {
		return 2;
	}
	return 1;
}

/** One consolidated global row per model (todo §5.Q). */
export interface ModelPerformanceModelRollup {
	providerId: string | null;
	modelId: string | null;
	runs: number;
	completedRuns: number;
	failedRuns: number;
	interruptedRuns: number;
	awaitingReviewRuns: number;
	successRate: number;
	lastObservedAt: number;
	/** Present only when sourced from the backend `model`-scope aggregate (todo §5.Q precision rollup). */
	averageWallTimeMs?: number | null;
	averageTimeToFirstTokenMs?: number | null;
}

/**
 * Roll the per-(scope × role × project × version) aggregates up into **one global row per model** (todo §5.Q —
 * the user saw the same model listed many times because every scope/role split is its own row). Only the
 * `overall` scope is summed (it already covers every run, split only by role), so combining its role rows by
 * `provider + model` reconstitutes the exact global totals for that model — `successRate` is recomputed from the
 * summed completed/total counts, so it stays exact. Per-role / per-project / per-version detail remains in the
 * breakdowns table.
 */
export function rollUpAggregatesByModel(
	aggregates: readonly RuntimeModelPerformanceAggregate[],
): ModelPerformanceModelRollup[] {
	const byModel = new Map<string, ModelPerformanceModelRollup>();
	for (const aggregate of aggregates) {
		if (aggregate.scope !== "overall") {
			continue;
		}
		const key = `${aggregate.providerId ?? "unknown_provider"}\u0000${aggregate.modelId ?? "unknown_model"}`;
		const current = byModel.get(key) ?? {
			providerId: aggregate.providerId,
			modelId: aggregate.modelId,
			runs: 0,
			completedRuns: 0,
			failedRuns: 0,
			interruptedRuns: 0,
			awaitingReviewRuns: 0,
			successRate: 0,
			lastObservedAt: 0,
		};
		current.runs += aggregate.runs;
		current.completedRuns += aggregate.completedRuns;
		current.failedRuns += aggregate.failedRuns;
		current.interruptedRuns += aggregate.interruptedRuns;
		current.awaitingReviewRuns += aggregate.awaitingReviewRuns;
		current.lastObservedAt = Math.max(current.lastObservedAt, aggregate.lastObservedAt);
		byModel.set(key, current);
	}
	return [...byModel.values()]
		.map((rollup) => ({ ...rollup, successRate: rollup.runs > 0 ? rollup.completedRuns / rollup.runs : 0 }))
		.sort((left, right) => right.runs - left.runs || right.lastObservedAt - left.lastObservedAt);
}

/**
 * Prefer the backend `model`-scope aggregate (todo §5.Q precision rollup) when present: it is recomputed
 * straight from the raw observations, so its success rate **and** timing averages are exact and loopback
 * endpoint spellings dedup the same way the model registry keys them. Older servers won't send the `model`
 * scope, so fall back to the client-side `overall`-scope roll-up (which has no timing).
 */
export function selectModelRollups(
	aggregates: readonly RuntimeModelPerformanceAggregate[],
): ModelPerformanceModelRollup[] {
	const modelScope = aggregates.filter((aggregate) => aggregate.scope === "model");
	if (modelScope.length === 0) {
		return rollUpAggregatesByModel(aggregates);
	}
	return modelScope
		.map((aggregate) => ({
			providerId: aggregate.providerId,
			modelId: aggregate.modelId,
			runs: aggregate.runs,
			completedRuns: aggregate.completedRuns,
			failedRuns: aggregate.failedRuns,
			interruptedRuns: aggregate.interruptedRuns,
			awaitingReviewRuns: aggregate.awaitingReviewRuns,
			successRate: aggregate.successRate,
			lastObservedAt: aggregate.lastObservedAt,
			averageWallTimeMs: aggregate.averageWallTimeMs,
			averageTimeToFirstTokenMs: aggregate.averageTimeToFirstTokenMs,
		}))
		.sort((left, right) => right.runs - left.runs || right.lastObservedAt - left.lastObservedAt);
}

/**
 * Global decomposition-knowledge totals (todo §5.B): how many decompositions consulted knowledge tools
 * (codebase retrieval / code index / architecture knowledge) before decomposing. Sums only the `overall`-scope
 * aggregates — each already covers every decomposition, split only by role/model, so summing them gives the
 * exact global totals without double-counting the version/project re-rollups; the rate is recomputed from the
 * summed counts.
 */
export function summarizeDecompositionKnowledge(aggregates: readonly RuntimeDecompositionKnowledgeUsageAggregate[]): {
	decompositions: number;
	withKnowledgeTools: number;
	rate: number;
} {
	const overall = aggregates.filter((aggregate) => aggregate.scope === "overall");
	const decompositions = overall.reduce((sum, aggregate) => sum + aggregate.decompositions, 0);
	const withKnowledgeTools = overall.reduce((sum, aggregate) => sum + aggregate.withKnowledgeTools, 0);
	return { decompositions, withKnowledgeTools, rate: decompositions > 0 ? withKnowledgeTools / decompositions : 0 };
}

// F2.22: a fitness cell is STALE when its last evaluation is older than this window (or its time is unknown — an
// unknown evaluation time fails cautious to stale, mirroring the §5.AC provenance staleness gate). 14 days keeps
// the browser honest about evidence that predates recent model/prompt changes.
export const FITNESS_STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

type FitnessRow = RuntimeFitnessTableResponse["rows"][number];
export type FitnessConfidenceBand = FitnessRow["confidenceBand"];
export type FitnessSortMode = "successRate" | "sampleCount" | "confidence";

export interface FitnessRowFilterOptions {
	/** `"all"` or a concrete role. */
	roleFilter: string;
	/** Keep only cells in the failing-LLM projection. */
	belowBarOnly: boolean;
	/** `"all"` or a concrete confidence band. */
	bandFilter: FitnessConfidenceBand | "all";
	/** `"all"` keeps everything; `"fresh"`/`"stale"` split on {@link FITNESS_STALE_AFTER_MS}. */
	stalenessFilter: "all" | "fresh" | "stale";
	sort: FitnessSortMode;
	/** Reference time for staleness (pass `Date.now()` at the call site; injected so the sort/filter stays pure). */
	now: number;
	/** Staleness window; defaults to {@link FITNESS_STALE_AFTER_MS}. */
	staleAfterMs?: number;
}

/** F2.22: a cell is stale when it was last evaluated before the window, or its evaluation time is unknown. */
export function isFitnessRowStale(row: FitnessRow, now: number, staleAfterMs = FITNESS_STALE_AFTER_MS): boolean {
	if (row.updatedAt === null) {
		return true;
	}
	return now - row.updatedAt > staleAfterMs;
}

/**
 * F2.22 fitness-browser projection: filter the stored rows by role / below-bar / confidence band / staleness, then
 * sort by success rate, sample count, or confidence (Wilson lower bound). Pure + total so the browser's controls are
 * one tested place, separate from the dialog's render. Every sort breaks ties on sample count so a well-sampled cell
 * ranks ahead of a one-off with the same headline number.
 */
export function filterAndSortFitnessRows(rows: readonly FitnessRow[], options: FitnessRowFilterOptions): FitnessRow[] {
	const staleAfterMs = options.staleAfterMs ?? FITNESS_STALE_AFTER_MS;
	const filtered = rows.filter((row) => {
		if (options.roleFilter !== "all" && row.role !== options.roleFilter) {
			return false;
		}
		if (options.belowBarOnly && !row.belowBar) {
			return false;
		}
		if (options.bandFilter !== "all" && row.confidenceBand !== options.bandFilter) {
			return false;
		}
		if (options.stalenessFilter !== "all") {
			const stale = isFitnessRowStale(row, options.now, staleAfterMs);
			if (options.stalenessFilter === "stale" ? !stale : stale) {
				return false;
			}
		}
		return true;
	});
	return filtered.sort((left, right) => {
		if (options.sort === "confidence") {
			return right.confidenceLowerBound - left.confidenceLowerBound || right.sampleCount - left.sampleCount;
		}
		if (options.sort === "sampleCount") {
			return right.sampleCount - left.sampleCount || right.successRate - left.successRate;
		}
		return right.successRate - left.successRate || right.sampleCount - left.sampleCount;
	});
}

/** F3.35 (web surface): default per-role confidence bars a measured model must clear. */
const FITNESS_CAPABILITY_BARS: readonly RoleQualityBar[] = [
	{ role: "architect", minConfidence: 0.7 },
	{ role: "decompose", minConfidence: 0.7 },
	{ role: "reviewer", minConfidence: 0.7 },
	{ role: "worker", minConfidence: 0.6 },
];

/**
 * F3.35 capability-ceiling over the fitness rows already in the browser: which roles have NO measured model whose
 * confidence (Wilson lower bound) clears the bar. Client-side over data already present — no new endpoint. Uses the
 * shared core so the CLI (`nklein dev capability-ceiling`) and this view agree.
 */
export function deriveFitnessCapabilityCeiling(rows: readonly FitnessRow[]): CapabilityCeilingVerdict[] {
	const fitness: FleetModelFitness[] = rows.map((row) => ({
		modelKey: row.modelKey,
		role: row.role,
		qualityConfidence: row.confidenceLowerBound,
		// "loaded" here means "measured" — the fitness browser only holds models with recorded evidence.
		loaded: true,
	}));
	const barsForPresentRoles = FITNESS_CAPABILITY_BARS.filter((bar) => rows.some((row) => row.role === bar.role));
	return ceilingHitRoles(assessCapabilityCeiling(barsForPresentRoles, fitness));
}

/**
 * F3.26 re-evaluation priority over the fitness rows: which cells to re-run first (staleness × uncertainty × impact),
 * from the same rows already in the browser. Shared core so the CLI (`nklein dev eval-freshness`) and this view agree.
 */
export function deriveTopReevalCells(rows: readonly FitnessRow[], now: number, limit = 3): EvalCellReevaluationScore[] {
	const cells: EvalCellFreshnessInput[] = rows.map((row) => ({
		cellKey: `${row.modelKey}::${row.role}::${row.difficultyTier}`,
		sampleCount: row.sampleCount,
		lastEvaluatedAt: row.updatedAt,
		recordedVersionSignature: null,
		currentVersionSignature: "",
		usageCount: row.sampleCount,
	}));
	return rankEvalCellsForReevaluation(cells, undefined, now).slice(0, limit);
}

function summarizeObservations(observations: RuntimeModelPerformanceObservation[]): {
	totalRuns: number;
	completedRuns: number;
	interruptedRuns: number;
	failedRuns: number;
} {
	return observations.reduce(
		(summary, observation) => ({
			totalRuns: summary.totalRuns + 1,
			completedRuns: summary.completedRuns + (observation.outcome === "completed" ? 1 : 0),
			interruptedRuns: summary.interruptedRuns + (observation.outcome === "interrupted" ? 1 : 0),
			failedRuns:
				summary.failedRuns + (observation.outcome === "failed" || observation.outcome === "unknown" ? 1 : 0),
		}),
		{ totalRuns: 0, completedRuns: 0, interruptedRuns: 0, failedRuns: 0 },
	);
}

function summarizeKnowledgeToolObservations(observations: RuntimeKnowledgeToolUsageObservation[]): {
	totalCalls: number;
	startedCalls: number;
	succeededCalls: number;
	failedCalls: number;
} {
	return observations.reduce(
		(summary, observation) => ({
			totalCalls: summary.totalCalls + 1,
			startedCalls: summary.startedCalls + (observation.outcome === "started" ? 1 : 0),
			succeededCalls: summary.succeededCalls + (observation.outcome === "succeeded" ? 1 : 0),
			failedCalls: summary.failedCalls + (observation.outcome === "failed" ? 1 : 0),
		}),
		{ totalCalls: 0, startedCalls: 0, succeededCalls: 0, failedCalls: 0 },
	);
}

export function ModelPerformanceStatsDialog({
	open,
	onOpenChange,
	workspaceId,
}: ModelPerformanceStatsDialogProps): JSX.Element {
	const [stats, setStats] = useState<RuntimeModelPerformanceStatsResponse | null>(null);
	const [knowledgeStats, setKnowledgeStats] = useState<RuntimeKnowledgeToolUsageStatsResponse | null>(null);
	const [behaviorProfiles, setBehaviorProfiles] = useState<RuntimeModelBehaviorProfilesResponse | null>(null);
	const [fitnessTable, setFitnessTable] = useState<RuntimeFitnessTableResponse | null>(null);
	// §5.AB fitness browser controls: filter by role, sort by fitness (successRate desc) / samples / confidence.
	const [fitnessRoleFilter, setFitnessRoleFilter] = useState<string>("all");
	const [fitnessSort, setFitnessSort] = useState<FitnessSortMode>("successRate");
	// F2.22 filters: below-bar-only, confidence band, and staleness.
	const [fitnessBelowBarOnly, setFitnessBelowBarOnly] = useState(false);
	const [fitnessBandFilter, setFitnessBandFilter] = useState<FitnessConfidenceBand | "all">("all");
	const [fitnessStalenessFilter, setFitnessStalenessFilter] = useState<"all" | "fresh" | "stale">("all");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	// §5.AB "Evaluate connected models" (todo 6544): on-demand eval of every LOADED model + fitness persist.
	const [evalRunning, setEvalRunning] = useState(false);
	const [evalResult, setEvalResult] = useState<RuntimeEvaluateConnectedModelsResponse | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextModelStats, nextKnowledgeStats, nextBehaviorProfiles, nextFitnessTable] = await Promise.all([
				fetchModelPerformanceStats(workspaceId),
				fetchKnowledgeToolUsageStats(workspaceId),
				fetchModelBehaviorProfiles(workspaceId),
				fetchFitnessTable(workspaceId),
			]);
			setStats(nextModelStats);
			setKnowledgeStats(nextKnowledgeStats);
			setBehaviorProfiles(nextBehaviorProfiles);
			setFitnessTable(nextFitnessTable);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [workspaceId]);

	const runEval = useCallback(async () => {
		setEvalRunning(true);
		setError(null);
		try {
			const result = await evaluateConnectedModels(workspaceId);
			setEvalResult(result);
			// Fold the freshly-persisted fitness back into the browser so the tables reflect the new evidence.
			await refresh();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setEvalRunning(false);
		}
	}, [workspaceId, refresh]);

	useEffect(() => {
		if (open) {
			void refresh();
		}
	}, [open, refresh]);

	const topAggregates = useMemo(
		() =>
			[...(stats?.aggregates ?? [])]
				.filter((aggregate) => aggregate.scope !== "model")
				.sort(
					(left, right) =>
						aggregateSortValue(right) - aggregateSortValue(left) ||
						right.runs - left.runs ||
						right.lastObservedAt - left.lastObservedAt,
				)
				.slice(0, 24),
		[stats?.aggregates],
	);
	const recentObservations = stats?.observations.slice(0, 20) ?? [];
	const totals = summarizeObservations(stats?.observations ?? []);
	const byModelRollups = useMemo(() => selectModelRollups(stats?.aggregates ?? []), [stats?.aggregates]);
	const byModelHasTiming = byModelRollups.some((rollup) => typeof rollup.averageWallTimeMs === "number");
	const topKnowledgeAggregates = useMemo(
		() =>
			[...(knowledgeStats?.aggregates ?? [])]
				.sort(
					(left, right) =>
						aggregateSortValue(right) - aggregateSortValue(left) ||
						right.calls - left.calls ||
						right.lastObservedAt - left.lastObservedAt,
				)
				.slice(0, 24),
		[knowledgeStats?.aggregates],
	);
	const fitnessRoles = useMemo(
		() => [...new Set((fitnessTable?.rows ?? []).map((row) => row.role))].sort(),
		[fitnessTable?.rows],
	);
	const capabilityCeilingHits = useMemo(
		() => deriveFitnessCapabilityCeiling(fitnessTable?.rows ?? []),
		[fitnessTable?.rows],
	);
	const topReevalCells = useMemo(
		() => deriveTopReevalCells(fitnessTable?.rows ?? [], Date.now()),
		[fitnessTable?.rows],
	);
	const fitnessRows = useMemo(
		() =>
			filterAndSortFitnessRows(fitnessTable?.rows ?? [], {
				roleFilter: fitnessRoleFilter,
				belowBarOnly: fitnessBelowBarOnly,
				bandFilter: fitnessBandFilter,
				stalenessFilter: fitnessStalenessFilter,
				sort: fitnessSort,
				now: Date.now(),
			}),
		[
			fitnessTable?.rows,
			fitnessRoleFilter,
			fitnessBelowBarOnly,
			fitnessBandFilter,
			fitnessStalenessFilter,
			fitnessSort,
		],
	);
	const recentKnowledgeObservations = knowledgeStats?.observations.slice(0, 20) ?? [];
	const knowledgeTotals = summarizeKnowledgeToolObservations(knowledgeStats?.observations ?? []);
	const topDecompositionKnowledgeAggregates = useMemo(
		() =>
			[...(knowledgeStats?.decompositionKnowledgeAggregates ?? [])]
				.sort(
					(left, right) =>
						aggregateSortValue(right) - aggregateSortValue(left) ||
						right.decompositions - left.decompositions ||
						right.lastDecomposedAt - left.lastDecomposedAt,
				)
				.slice(0, 24),
		[knowledgeStats?.decompositionKnowledgeAggregates],
	);
	const decompositionKnowledgeTotals = useMemo(
		() => summarizeDecompositionKnowledge(knowledgeStats?.decompositionKnowledgeAggregates ?? []),
		[knowledgeStats?.decompositionKnowledgeAggregates],
	);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			contentClassName="!w-[min(1180px,calc(100vw-24px))] !max-w-none !max-h-[calc(100vh-24px)]"
		>
			<DialogHeader title="Model Performance" icon={<BarChart3 size={16} />} />
			<div className="max-h-[min(720px,calc(100vh-120px))] overflow-y-auto bg-surface-1 px-5 pb-5">
				<div className="sticky top-0 z-10 -mx-5 flex items-center justify-between gap-3 bg-surface-1 px-5 py-3">
					<div className="text-[13px] text-text-secondary">
						Observed runs and knowledge-tool usage by role, model, project, and !Klein version.
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							icon={evalRunning ? <Spinner size={14} /> : <FlaskConical size={14} />}
							onClick={() => void runEval()}
							disabled={evalRunning || loading}
							title="Run the eval corpus against every currently-loaded model and record fitness. Never loads a model."
						>
							{evalRunning ? "Evaluating…" : "Evaluate connected models"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							icon={loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
							onClick={() => void refresh()}
							disabled={loading}
						>
							Refresh
						</Button>
					</div>
				</div>
				{error ? (
					<div className="mb-3 rounded-md border border-status-red/50 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
						{error}
					</div>
				) : null}
				{evalResult ? (
					<div className="mb-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px]">
						{evalResult.skippedReason ? (
							<div className="text-status-gold">{evalResult.skippedReason}</div>
						) : (
							<>
								<div className="mb-1.5 font-medium text-text-primary">
									Evaluated {evalResult.models.length} loaded model
									{evalResult.models.length === 1 ? "" : "s"} · fitness recorded
								</div>
								<div className="flex flex-col gap-1">
									{evalResult.models.map((model) => (
										<div key={model.modelId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
											<span className="font-mono text-text-primary">{model.modelId}</span>
											<span className="text-text-tertiary">({model.strategy})</span>
											<span className="text-text-secondary">
												mean {model.meanScore.toFixed(2)} over {model.scoredAttempts}/{model.totalAttempts}{" "}
												cells
											</span>
											{model.byRole.map((role) => (
												<span key={role.role} className="text-text-tertiary">
													· {role.role} q{role.qualityScore.toFixed(2)}/r{role.reliability.toFixed(2)}
												</span>
											))}
										</div>
									))}
								</div>
							</>
						)}
					</div>
				) : null}
				<div className="grid gap-3 md:grid-cols-4">
					<Metric label="Runs" value={formatNumber(totals.totalRuns)} />
					<Metric label="Completed" value={formatNumber(totals.completedRuns)} />
					<Metric label="Interrupted" value={formatNumber(totals.interruptedRuns)} />
					<Metric label="Failed" value={formatNumber(totals.failedRuns)} />
				</div>
				<SectionTitle title="By Model (global)" />
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full min-w-[640px] border-collapse text-left text-[12px]">
						<thead className="bg-surface-0 text-text-secondary">
							<tr>
								<TableHead>Model</TableHead>
								<TableHead>Runs</TableHead>
								<TableHead>Completed</TableHead>
								<TableHead>Failed</TableHead>
								<TableHead>Interrupted</TableHead>
								<TableHead>Success</TableHead>
								{byModelHasTiming ? <TableHead>Avg Time</TableHead> : null}
								<TableHead>Last Seen</TableHead>
							</tr>
						</thead>
						<tbody>
							{byModelRollups.map((rollup) => (
								<tr
									key={`${rollup.providerId ?? "?"} ${rollup.modelId ?? "?"}`}
									className="border-t border-border bg-surface-2 text-text-primary"
								>
									<TableCell>{formatModel(rollup)}</TableCell>
									<TableCell>{rollup.runs}</TableCell>
									<TableCell>{formatNumber(rollup.completedRuns)}</TableCell>
									<TableCell>{formatNumber(rollup.failedRuns)}</TableCell>
									<TableCell>{formatNumber(rollup.interruptedRuns)}</TableCell>
									<TableCell>{formatPercent(rollup.successRate)}</TableCell>
									{byModelHasTiming ? (
										<TableCell>{formatDuration(rollup.averageWallTimeMs ?? null)}</TableCell>
									) : null}
									<TableCell>{formatTimestamp(rollup.lastObservedAt)}</TableCell>
								</tr>
							))}
							{byModelRollups.length === 0 ? (
								<tr className="border-t border-border bg-surface-2">
									<td
										className="px-3 py-5 text-center text-[13px] text-text-secondary"
										colSpan={byModelHasTiming ? 8 : 7}
									>
										No model performance observations have been recorded yet.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
				<SectionTitle title="Model fitness (§5.AB per-model × role × difficulty)" />
				<div
					className="mb-2 flex items-center gap-3 text-[12px] text-text-secondary"
					data-testid="fitness-controls"
				>
					<label className="flex items-center gap-1.5">
						Role
						<select
							className="rounded border border-border bg-surface-0 px-1.5 py-0.5 text-text-primary"
							value={fitnessRoleFilter}
							onChange={(event) => setFitnessRoleFilter(event.target.value)}
						>
							<option value="all">all</option>
							{fitnessRoles.map((role) => (
								<option key={role} value={role}>
									{role}
								</option>
							))}
						</select>
					</label>
					<label className="flex items-center gap-1.5">
						Sort
						<select
							className="rounded border border-border bg-surface-0 px-1.5 py-0.5 text-text-primary"
							value={fitnessSort}
							data-testid="fitness-sort"
							onChange={(event) => setFitnessSort(event.target.value as FitnessSortMode)}
						>
							<option value="successRate">fitness (success rate)</option>
							<option value="sampleCount">samples</option>
							<option value="confidence">confidence</option>
						</select>
					</label>
					<label className="flex items-center gap-1.5">
						Confidence
						<select
							className="rounded border border-border bg-surface-0 px-1.5 py-0.5 text-text-primary"
							value={fitnessBandFilter}
							data-testid="fitness-band-filter"
							onChange={(event) => setFitnessBandFilter(event.target.value as FitnessConfidenceBand | "all")}
						>
							<option value="all">any</option>
							<option value="high">high</option>
							<option value="medium">medium</option>
							<option value="low">low</option>
							<option value="none">none</option>
						</select>
					</label>
					<label className="flex items-center gap-1.5">
						Freshness
						<select
							className="rounded border border-border bg-surface-0 px-1.5 py-0.5 text-text-primary"
							value={fitnessStalenessFilter}
							data-testid="fitness-staleness-filter"
							onChange={(event) => setFitnessStalenessFilter(event.target.value as "all" | "fresh" | "stale")}
						>
							<option value="all">any</option>
							<option value="fresh">fresh</option>
							<option value="stale">stale</option>
						</select>
					</label>
					<label className="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={fitnessBelowBarOnly}
							data-testid="fitness-below-bar-only"
							onChange={(event) => setFitnessBelowBarOnly(event.target.checked)}
						/>
						Below bar only
					</label>
				</div>
				{capabilityCeilingHits.length > 0 && (
					<div
						className="mb-2 rounded-md border border-status-red/40 bg-status-red/10 p-2 text-[12px] text-text-primary"
						data-testid="capability-ceiling-summary"
					>
						<span className="font-semibold text-status-red">Capability ceiling (F3.35):</span>{" "}
						{capabilityCeilingHits.map((hit) => (
							<span key={hit.role} className="mr-2">
								{hit.role} (best {hit.bestLoaded?.confidence.toFixed(2) ?? "?"} &lt;{" "}
								{(hit.shortfall + (hit.bestLoaded?.confidence ?? 0)).toFixed(2)})
							</span>
						))}
						— load a stronger model for these roles.
					</div>
				)}
				{topReevalCells.length > 0 && (
					<div
						className="mb-2 rounded-md border border-border bg-surface-1 p-2 text-[12px] text-text-secondary"
						data-testid="reeval-priority-summary"
					>
						<span className="font-semibold text-text-primary">Re-evaluate first (F3.26):</span>{" "}
						{topReevalCells.map((cell) => (
							<span key={cell.cellKey} className="mr-2">
								{cell.cellKey.split("::").slice(-2).join("/")} ({Math.round(cell.priority * 100)})
							</span>
						))}
					</div>
				)}
				<div className="overflow-x-auto rounded-md border border-border" data-testid="fitness-table">
					<table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
						<thead className="bg-surface-0 text-text-secondary">
							<tr>
								<TableHead>Model</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Difficulty</TableHead>
								<TableHead>Samples</TableHead>
								<TableHead>Success</TableHead>
								<TableHead>Confidence</TableHead>
								<TableHead>Retry Budget</TableHead>
								<TableHead>Speed</TableHead>
								<TableHead>Status</TableHead>
							</tr>
						</thead>
						<tbody>
							{fitnessRows.map((row) => (
								<tr
									key={`${row.modelKey}|${row.role}|${row.difficultyTier}`}
									className="border-t border-border bg-surface-2 text-text-primary"
								>
									<TableCell>{row.modelKey}</TableCell>
									<TableCell>{row.role}</TableCell>
									<TableCell>{row.difficultyTier}</TableCell>
									<TableCell>{formatNumber(row.sampleCount)}</TableCell>
									<TableCell>{formatPercent(row.successRate)}</TableCell>
									<TableCell>
										<span
											className={fitnessBandClassName(row.confidenceBand)}
											data-testid="fitness-confidence-band"
										>
											{row.confidenceBand}
										</span>{" "}
										<span className="text-text-tertiary">({formatPercent(row.confidenceLowerBound)})</span>
									</TableCell>
									<TableCell>{row.retryBudget}</TableCell>
									<TableCell>
										{row.tokensPerSec === null ? "—" : `${Math.round(row.tokensPerSec)} tok/s`}
									</TableCell>
									<TableCell>
										{row.belowBar ? <span className="text-status-red">below bar</span> : "ok"}
									</TableCell>
								</tr>
							))}
							{fitnessRows.length === 0 ? (
								<tr className="border-t border-border bg-surface-2">
									<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={9}>
										No fitness cells recorded yet — cells fill as terminal task runs fold into the §5.AB
										store.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
				<SectionTitle title="Learned model behavior (§5.AA recovery-ladder telemetry)" />
				<div className="overflow-x-auto rounded-md border border-border" data-testid="model-behavior-profiles">
					<table className="w-full min-w-[880px] border-collapse text-left text-[12px]">
						<thead className="bg-surface-0 text-text-secondary">
							<tr>
								<TableHead>Model</TableHead>
								<TableHead>Samples</TableHead>
								<TableHead>Success</TableHead>
								<TableHead>Avg Retries</TableHead>
								<TableHead>Dominant Failure</TableHead>
								<TableHead>Preferred Format</TableHead>
								<TableHead>Responsive Phrasing</TableHead>
								<TableHead>Complexity Ceiling</TableHead>
								<TableHead>Quality Knee</TableHead>
								<TableHead>Updated</TableHead>
							</tr>
						</thead>
						<tbody>
							{(behaviorProfiles?.profiles ?? []).map((profile) => (
								<tr key={profile.modelId} className="border-t border-border bg-surface-2 text-text-primary">
									<TableCell>{profile.modelId}</TableCell>
									<TableCell>{formatNumber(profile.samples)}</TableCell>
									<TableCell>{formatPercent(profile.successRate)}</TableCell>
									<TableCell>{profile.avgRetries.toFixed(1)}</TableCell>
									<TableCell>{profile.dominantFailureMode ?? "—"}</TableCell>
									<TableCell>{profile.preferredToolCallFormat ?? "—"}</TableCell>
									<TableCell>{profile.preferredPromptVariantFamily ?? "—"}</TableCell>
									<TableCell>
										{profile.complexityCeiling === null ? "—" : `${profile.complexityCeiling} tools`}
									</TableCell>
									<TableCell>
										{profile.qualityEffectiveContextTokens === null &&
										profile.qualityDegradedAtTokens === null
											? "—"
											: `ok ≤ ${formatNumber(profile.qualityEffectiveContextTokens)} / degrades ≥ ${formatNumber(profile.qualityDegradedAtTokens)}`}
									</TableCell>
									<TableCell>{formatTimestamp(profile.updatedAt)}</TableCell>
								</tr>
							))}
							{(behaviorProfiles?.profiles ?? []).length === 0 ? (
								<tr className="border-t border-border bg-surface-2">
									<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={10}>
										No learned behavior yet — profiles build up as the recovery ladder records attempt
										outcomes.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
				<SectionTitle title="Breakdowns by scope / role / project / version" />
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full min-w-[940px] border-collapse text-left text-[12px]">
						<thead className="bg-surface-0 text-text-secondary">
							<tr>
								<TableHead>Scope</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Model</TableHead>
								<TableHead>Project</TableHead>
								<TableHead>Version</TableHead>
								<TableHead>Runs</TableHead>
								<TableHead>Success</TableHead>
								<TableHead>Avg Time</TableHead>
								<TableHead>First Token</TableHead>
								<TableHead>Avg Output</TableHead>
								<TableHead>Context</TableHead>
								<TableHead>Last Seen</TableHead>
							</tr>
						</thead>
						<tbody>
							{topAggregates.map((aggregate) => (
								<tr key={aggregate.key} className="border-t border-border bg-surface-2 text-text-primary">
									<TableCell>{aggregate.scope}</TableCell>
									<TableCell>{aggregate.role}</TableCell>
									<TableCell>{formatModel(aggregate)}</TableCell>
									<TableCell>{aggregate.projectName ?? "All projects"}</TableCell>
									<TableCell>{aggregate.appVersion ?? "All versions"}</TableCell>
									<TableCell>{aggregate.runs}</TableCell>
									<TableCell>{formatPercent(aggregate.successRate)}</TableCell>
									<TableCell>{formatDuration(aggregate.averageWallTimeMs)}</TableCell>
									<TableCell>{formatDuration(aggregate.averageTimeToFirstTokenMs)}</TableCell>
									<TableCell>{formatNumber(aggregate.averageOutputTokens)}</TableCell>
									<TableCell>{formatPercent(aggregate.averageContextPressure)}</TableCell>
									<TableCell>{formatTimestamp(aggregate.lastObservedAt)}</TableCell>
								</tr>
							))}
							{topAggregates.length === 0 ? (
								<tr className="border-t border-border bg-surface-2">
									<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={12}>
										No model performance observations have been recorded yet.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
				<SectionTitle title="Recent Model Observations" />
				<div className="overflow-x-auto rounded-md border border-border">
					<table className="w-full min-w-[860px] border-collapse text-left text-[12px]">
						<thead className="bg-surface-0 text-text-secondary">
							<tr>
								<TableHead>Observed</TableHead>
								<TableHead>Task</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Model</TableHead>
								<TableHead>Outcome</TableHead>
								<TableHead>Duration</TableHead>
								<TableHead>Tokens</TableHead>
								<TableHead>Context</TableHead>
								<TableHead>Warning</TableHead>
							</tr>
						</thead>
						<tbody>
							{recentObservations.map((observation) => (
								<tr key={observation.id} className="border-t border-border bg-surface-2 text-text-primary">
									<TableCell>{formatTimestamp(observation.recordedAt)}</TableCell>
									<TableCell>{observation.taskTitle ?? observation.taskId}</TableCell>
									<TableCell>{observation.role}</TableCell>
									<TableCell>{formatModel(observation)}</TableCell>
									<TableCell>{observation.outcome}</TableCell>
									<TableCell>{formatDuration(observation.wallTimeMs)}</TableCell>
									<TableCell>
										{formatNumber(observation.usage?.inputTokens)} /{" "}
										{formatNumber(observation.usage?.outputTokens)}
									</TableCell>
									<TableCell>{formatPercent(observation.contextPressure)}</TableCell>
									<TableCell>{observation.warningMessage ?? observation.latestHookEvent ?? ""}</TableCell>
								</tr>
							))}
							{recentObservations.length === 0 ? (
								<tr className="border-t border-border bg-surface-2">
									<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={9}>
										Start or finish NKlein cards to populate this view.
									</td>
								</tr>
							) : null}
						</tbody>
					</table>
				</div>
				<SectionTitle title="Knowledge Tool Usage" />
				<div className="grid gap-3 md:grid-cols-4">
					<Metric label="Tool Events" value={formatNumber(knowledgeTotals.totalCalls)} />
					<Metric label="Started" value={formatNumber(knowledgeTotals.startedCalls)} />
					<Metric label="Succeeded" value={formatNumber(knowledgeTotals.succeededCalls)} />
					<Metric label="Failed" value={formatNumber(knowledgeTotals.failedCalls)} />
				</div>
				<KnowledgeToolAggregateTable aggregates={topKnowledgeAggregates} />
				<KnowledgeToolObservationTable observations={recentKnowledgeObservations} />
				<SectionTitle title="Decomposition Knowledge (knowledge tools used before decomposing)" />
				<div className="grid gap-3 md:grid-cols-3">
					<Metric label="Decompositions" value={formatNumber(decompositionKnowledgeTotals.decompositions)} />
					<Metric
						label="Consulted Knowledge First"
						value={formatNumber(decompositionKnowledgeTotals.withKnowledgeTools)}
					/>
					<Metric label="Knowledge-First Rate" value={formatPercent(decompositionKnowledgeTotals.rate)} />
				</div>
				<DecompositionKnowledgeTable aggregates={topDecompositionKnowledgeAggregates} />
			</div>
		</Dialog>
	);
}

function KnowledgeToolAggregateTable({
	aggregates,
}: {
	aggregates: RuntimeKnowledgeToolUsageAggregate[];
}): JSX.Element {
	return (
		<div className="mt-3 overflow-x-auto rounded-md border border-border">
			<table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
				<thead className="bg-surface-0 text-text-secondary">
					<tr>
						<TableHead>Scope</TableHead>
						<TableHead>Category</TableHead>
						<TableHead>Tool</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Project</TableHead>
						<TableHead>Calls</TableHead>
						<TableHead>Started</TableHead>
						<TableHead>Succeeded</TableHead>
						<TableHead>Failed</TableHead>
						<TableHead>Success</TableHead>
						<TableHead>Last Seen</TableHead>
					</tr>
				</thead>
				<tbody>
					{aggregates.map((aggregate) => (
						<tr key={aggregate.key} className="border-t border-border bg-surface-2 text-text-primary">
							<TableCell>{aggregate.scope}</TableCell>
							<TableCell>{aggregate.toolCategory}</TableCell>
							<TableCell>{aggregate.toolName}</TableCell>
							<TableCell>{aggregate.role}</TableCell>
							<TableCell>{formatModel(aggregate)}</TableCell>
							<TableCell>{aggregate.projectName ?? "All projects"}</TableCell>
							<TableCell>{aggregate.calls}</TableCell>
							<TableCell>{aggregate.startedCalls}</TableCell>
							<TableCell>{aggregate.succeededCalls}</TableCell>
							<TableCell>{aggregate.failedCalls}</TableCell>
							<TableCell>{formatPercent(aggregate.successRate)}</TableCell>
							<TableCell>{formatTimestamp(aggregate.lastObservedAt)}</TableCell>
						</tr>
					))}
					{aggregates.length === 0 ? (
						<tr className="border-t border-border bg-surface-2">
							<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={12}>
								No knowledge-tool usage observations have been recorded yet.
							</td>
						</tr>
					) : null}
				</tbody>
			</table>
		</div>
	);
}

function KnowledgeToolObservationTable({
	observations,
}: {
	observations: RuntimeKnowledgeToolUsageObservation[];
}): JSX.Element {
	return (
		<div className="mt-3 overflow-x-auto rounded-md border border-border">
			<table className="w-full min-w-[920px] border-collapse text-left text-[12px]">
				<thead className="bg-surface-0 text-text-secondary">
					<tr>
						<TableHead>Observed</TableHead>
						<TableHead>Task</TableHead>
						<TableHead>Category</TableHead>
						<TableHead>Tool</TableHead>
						<TableHead>Outcome</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Input</TableHead>
					</tr>
				</thead>
				<tbody>
					{observations.map((observation) => (
						<tr key={observation.id} className="border-t border-border bg-surface-2 text-text-primary">
							<TableCell>{formatTimestamp(observation.recordedAt)}</TableCell>
							<TableCell>{observation.taskTitle ?? observation.taskId}</TableCell>
							<TableCell>{observation.toolCategory}</TableCell>
							<TableCell>{observation.toolName}</TableCell>
							<TableCell>{observation.outcome}</TableCell>
							<TableCell>{observation.role}</TableCell>
							<TableCell>{formatModel(observation)}</TableCell>
							<TableCell>{observation.toolInputSummary ?? observation.activityText ?? ""}</TableCell>
						</tr>
					))}
					{observations.length === 0 ? (
						<tr className="border-t border-border bg-surface-2">
							<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={8}>
								Start NKlein cards that use retrieval, file, search, or knowledge tools to populate this view.
							</td>
						</tr>
					) : null}
				</tbody>
			</table>
		</div>
	);
}

function DecompositionKnowledgeTable({
	aggregates,
}: {
	aggregates: RuntimeDecompositionKnowledgeUsageAggregate[];
}): JSX.Element {
	return (
		<div className="mt-3 overflow-x-auto rounded-md border border-border">
			<table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
				<thead className="bg-surface-0 text-text-secondary">
					<tr>
						<TableHead>Scope</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Project</TableHead>
						<TableHead>Decompositions</TableHead>
						<TableHead>Used Knowledge</TableHead>
						<TableHead>Without</TableHead>
						<TableHead>Knowledge-First</TableHead>
						<TableHead>Last Decomposed</TableHead>
					</tr>
				</thead>
				<tbody>
					{aggregates.map((aggregate) => (
						<tr key={aggregate.key} className="border-t border-border bg-surface-2 text-text-primary">
							<TableCell>{aggregate.scope}</TableCell>
							<TableCell>{aggregate.role}</TableCell>
							<TableCell>{formatModel(aggregate)}</TableCell>
							<TableCell>{aggregate.projectName ?? "All projects"}</TableCell>
							<TableCell>{aggregate.decompositions}</TableCell>
							<TableCell>{aggregate.withKnowledgeTools}</TableCell>
							<TableCell>{aggregate.withoutKnowledgeTools}</TableCell>
							<TableCell>{formatPercent(aggregate.knowledgeUsageRate)}</TableCell>
							<TableCell>{formatTimestamp(aggregate.lastDecomposedAt)}</TableCell>
						</tr>
					))}
					{aggregates.length === 0 ? (
						<tr className="border-t border-border bg-surface-2">
							<td className="px-3 py-5 text-center text-[13px] text-text-secondary" colSpan={9}>
								No decompositions recorded yet — the signal needs a planning session that ran decompose_project.
							</td>
						</tr>
					) : null}
				</tbody>
			</table>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
	return (
		<div className="rounded-md border border-border bg-surface-2 px-3 py-2">
			<div className="text-[11px] uppercase text-text-tertiary">{label}</div>
			<div className="mt-1 text-lg font-semibold text-text-primary">{value}</div>
		</div>
	);
}

function SectionTitle({ title }: { title: string }): JSX.Element {
	return <h3 className="mb-2 mt-5 text-[13px] font-semibold text-text-primary">{title}</h3>;
}

function TableHead({ children }: { children: ReactNode }): JSX.Element {
	return <th className="px-3 py-2 font-medium">{children}</th>;
}

function TableCell({ children }: { children: ReactNode }): JSX.Element {
	return <td className="max-w-[260px] truncate px-3 py-2 align-top">{children}</td>;
}
