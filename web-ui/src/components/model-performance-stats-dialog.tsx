import { BarChart3, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { fetchKnowledgeToolUsageStats, fetchModelPerformanceStats } from "@/runtime/runtime-config-query";
import type {
	RuntimeKnowledgeToolUsageAggregate,
	RuntimeKnowledgeToolUsageObservation,
	RuntimeKnowledgeToolUsageStatsResponse,
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

function aggregateSortValue(aggregate: { scope: "overall" | "project" | "version" }): number {
	if (aggregate.scope === "project") {
		return 3;
	}
	if (aggregate.scope === "version") {
		return 2;
	}
	return 1;
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
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nextModelStats, nextKnowledgeStats] = await Promise.all([
				fetchModelPerformanceStats(workspaceId),
				fetchKnowledgeToolUsageStats(workspaceId),
			]);
			setStats(nextModelStats);
			setKnowledgeStats(nextKnowledgeStats);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		if (open) {
			void refresh();
		}
	}, [open, refresh]);

	const topAggregates = useMemo(
		() =>
			[...(stats?.aggregates ?? [])]
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
	const recentKnowledgeObservations = knowledgeStats?.observations.slice(0, 20) ?? [];
	const knowledgeTotals = summarizeKnowledgeToolObservations(knowledgeStats?.observations ?? []);

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
				{error ? (
					<div className="mb-3 rounded-md border border-status-red/50 bg-status-red/10 px-3 py-2 text-[13px] text-status-red">
						{error}
					</div>
				) : null}
				<div className="grid gap-3 md:grid-cols-4">
					<Metric label="Runs" value={formatNumber(totals.totalRuns)} />
					<Metric label="Completed" value={formatNumber(totals.completedRuns)} />
					<Metric label="Interrupted" value={formatNumber(totals.interruptedRuns)} />
					<Metric label="Failed" value={formatNumber(totals.failedRuns)} />
				</div>
				<SectionTitle title="Model Aggregates" />
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
										Start or finish Cline cards to populate this view.
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
								Start Cline cards that use retrieval, file, search, or knowledge tools to populate this view.
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
