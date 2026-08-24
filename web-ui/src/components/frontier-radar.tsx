import { Radar } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";
import { fetchFrontierLatest, fetchFrontierStatus, runFrontierResearch } from "@/runtime/queries/frontier";
import type { FrontierReport, FrontierStatusResponse } from "@/runtime/types";

/**
 * Frontier radar — the always-visible trigger (David 2026-08-22: "locate trigger in main ui, always, on
 * very right bottom with a status icon"). The icon's ring tells the truth at a glance: never ran (dim),
 * fresh (green), aging (gold), stale (red), running (pulse). The panel is the fun part: what the frontier
 * looks like right now, which open-weight models are worth a look on THIS machine, and "!Klein vs the
 * frontier" — the product comparing itself, live, against the latest research its own best local model
 * just read. Research only runs when retrieval egress is explicitly on; acquisition stays consent-gated —
 * the radar recommends, the operator fetches.
 */

const RING_BY_FRESHNESS: Record<string, string> = {
	never: "ring-border text-text-tertiary",
	fresh: "ring-status-green/60 text-status-green",
	aging: "ring-status-gold/60 text-status-gold",
	stale: "ring-status-red/60 text-status-red",
};

const VERDICT_TONE: Record<string, string> = {
	ahead: "bg-status-green/15 text-status-green",
	par: "bg-accent/15 text-accent-text",
	behind: "bg-status-red/15 text-status-red",
	different: "bg-status-purple/15 text-status-purple",
};

function formatAge(status: FrontierStatusResponse | null): string {
	if (!status || status.latestRanAt === null) return "never run";
	if (status.ageDays === null || status.ageDays < 1) return "ran today";
	return `ran ${status.ageDays}d ago`;
}

export function FrontierRadar({ workspaceId }: { workspaceId: string | null }): React.ReactElement {
	const [status, setStatus] = useState<FrontierStatusResponse | null>(null);
	const [report, setReport] = useState<FrontierReport | null>(null);
	const [open, setOpen] = useState(false);
	const [runMessage, setRunMessage] = useState<string | null>(null);

	const refresh = useCallback(() => {
		void fetchFrontierStatus(workspaceId)
			.then(setStatus)
			.catch(() => setStatus(null));
	}, [workspaceId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// While a run is live, poll so the pulse ends (and the panel fills) without a manual refresh.
	useEffect(() => {
		if (!status?.running) return;
		const timer = window.setInterval(refresh, 5_000);
		return () => window.clearInterval(timer);
	}, [status?.running, refresh]);

	useEffect(() => {
		if (!open) return;
		refresh();
		void fetchFrontierLatest(workspaceId)
			.then(setReport)
			.catch(() => setReport(null));
	}, [open, workspaceId, refresh]);

	const freshness = status?.freshness ?? "never";
	return (
		<div className="fixed bottom-3 right-3 z-50 flex flex-col items-end gap-2">
			{open ? (
				<div className="max-h-[70vh] w-96 overflow-y-auto rounded-lg border border-border-bright bg-surface-1 p-3 shadow-xl">
					<div className="flex items-baseline justify-between gap-2">
						<div className="text-sm font-semibold text-text-primary">Frontier radar</div>
						<div className="text-[11px] text-text-tertiary">{formatAge(status)}</div>
					</div>
					<div className="pt-0.5 text-[11px] text-text-tertiary">
						!Klein's best local model reads the frontier — and sizes itself up against it.
					</div>
					{status && !status.egressEnabled ? (
						<div className="mt-2 rounded border border-border p-2 text-xs text-status-gold">
							Retrieval egress is off, so the radar stays dark. Enable retrieval egress in Settings to let it
							research — nothing leaves this machine otherwise.
						</div>
					) : null}
					{report?.funLine ? (
						<div className="mt-2 rounded border border-accent/30 bg-accent/5 p-2 text-xs italic text-text-secondary">
							“{report.funLine}”
						</div>
					) : null}
					{report && report.findings.length > 0 ? (
						<div className="mt-3">
							<div className="text-xs font-medium text-text-primary">New on the frontier</div>
							<div className="mt-1 space-y-1.5">
								{report.findings.map((finding) => (
									<div key={`${finding.kind}-${finding.name}`} className="text-xs text-text-secondary">
										<span className="font-medium">{finding.name}</span>{" "}
										<span className="text-text-tertiary">
											({finding.kind}
											{finding.kind === "model"
												? finding.openWeights === true
													? " · open weights"
													: finding.openWeights === false
														? " · closed"
														: " · weights unknown"
												: ""}
											)
										</span>
										<div className="text-text-tertiary">{finding.summary}</div>
									</div>
								))}
							</div>
						</div>
					) : null}
					{report && report.modelRecommendations.length > 0 ? (
						<div className="mt-3">
							<div className="text-xs font-medium text-text-primary">Models worth a look here</div>
							<div className="mt-1 space-y-1.5">
								{report.modelRecommendations.map((recommendation) => (
									<div key={recommendation.name} className="text-xs text-text-secondary">
										<span className="font-medium">{recommendation.name}</span>{" "}
										<span
											className={cn(
												"rounded-full px-1.5 text-[10px]",
												recommendation.alreadyInstalled
													? "bg-status-green/15 text-status-green"
													: recommendation.localFit === "fits"
														? "bg-accent/15 text-accent-text"
														: "bg-text-primary/10 text-text-tertiary",
											)}
										>
											{recommendation.alreadyInstalled
												? "installed"
												: recommendation.localFit === "fits"
													? "fits this machine"
													: recommendation.localFit === "too_big"
														? "too big here"
														: "size unknown"}
										</span>
										<div className="text-text-tertiary">{recommendation.reason}</div>
										{!recommendation.alreadyInstalled ? (
											<code
												className="mt-0.5 block w-fit max-w-full truncate rounded bg-text-primary/5 px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary"
												title="Previews size, format safety and fit — downloads nothing until you re-run with --approve"
											>
												nklein setup acquire "{recommendation.name}"
											</code>
										) : null}
									</div>
								))}
							</div>
							<div className="mt-1 text-[10px] text-text-tertiary">
								Fetching stays your call: `setup acquire` previews first and downloads only on your explicit
								--approve, never automatically.
							</div>
						</div>
					) : null}
					{report && report.selfReflection.length > 0 ? (
						<div className="mt-3">
							<div className="text-xs font-medium text-text-primary">!Klein vs the frontier</div>
							<div className="mt-1 space-y-1.5">
								{report.selfReflection.map((row) => (
									<div key={row.topic} className="text-xs">
										<span className="font-medium text-text-secondary">{row.topic}</span>{" "}
										<span className={cn("rounded-full px-1.5 text-[10px]", VERDICT_TONE[row.verdict])}>
											{row.verdict}
										</span>
										<div className="text-text-tertiary">
											frontier: {row.frontier}
											<br />
											!Klein: {row.self}
										</div>
									</div>
								))}
							</div>
						</div>
					) : null}
					{report === null && status?.egressEnabled !== false ? (
						<div className="mt-2 text-xs text-text-tertiary">
							No report yet — run the radar to take !Klein's first look at the frontier.
						</div>
					) : null}
					<div className="mt-3 flex items-center justify-between gap-2">
						<button
							type="button"
							className="rounded-md border border-border-bright bg-surface-2 px-2 py-1 text-xs font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"
							disabled={status?.running === true}
							onClick={() => {
								setRunMessage(null);
								void runFrontierResearch(workspaceId)
									.then((outcome) => {
										setRunMessage(
											outcome.started ? "Radar spinning — this takes a few minutes." : outcome.reason,
										);
										refresh();
									})
									.catch((error: unknown) =>
										setRunMessage(error instanceof Error ? error.message : String(error)),
									);
							}}
						>
							{status?.running ? "Running…" : "Run radar now"}
						</button>
						{report ? (
							<div className="text-[10px] text-text-tertiary">
								{report.sourceCount} source(s) · {report.researchModelId}
							</div>
						) : null}
					</div>
					{runMessage ? <div className="pt-1 text-[11px] text-text-tertiary">{runMessage}</div> : null}
				</div>
			) : null}
			<button
				type="button"
				aria-label="Frontier radar"
				title={`Frontier radar — ${formatAge(status)}`}
				onClick={() => setOpen((current) => !current)}
				className={cn(
					"flex h-9 w-9 items-center justify-center rounded-full bg-surface-1 shadow-lg ring-2 transition-colors hover:bg-surface-2",
					RING_BY_FRESHNESS[freshness] ?? RING_BY_FRESHNESS.never,
				)}
			>
				<Radar size={17} className={cn(status?.running && "animate-spin")} />
			</button>
		</div>
	);
}
