// §5.AX: presentational per-model FLEET block for the board's "Local swarm" cockpit strip. Prop-driven and
// side-effect-free — it renders the machine-grouped fleet rows composed by `composeFleetRows`, matching the
// user-approved mockup (docs/dev/mockups/klein-restyle-2026-07-03.html: the `.fleet` / `.frow` block).
//
// Klein token language: cyan (accent) = worker/primary; violet (accent-2) = AI (architect/reviewer/speculative).
// Liveness dot: green when running, dashed violet for a `::spec` session, hollow when idle.

import { useState } from "react";

import type { FleetGroup, FleetLineage, FleetRole, FleetRow } from "@/components/fleet-strip-model";
import { isActiveFleetRow, summarizeIdleFleetRows } from "@/components/fleet-strip-model";
import { cn } from "@/components/ui/cn";

const ROLE_TAG_LABEL: Record<Exclude<FleetRole, null>, string> = {
	architect: "arch",
	worker: "wrk",
	reviewer: "rev",
};

// Architect/reviewer = AI (violet); worker = primary (cyan). Mirrors the mockup's .role-* rules.
const ROLE_TAG_CLASS: Record<Exclude<FleetRole, null>, string> = {
	architect: "border-accent-2/45 text-accent-2",
	worker: "border-accent/40 text-accent",
	reviewer: "border-status-gold/40 text-status-gold",
};

// Lineage chip color: gpt-oss reads as primary (cyan) in the mockup; everything else uses the AI violet wash so a
// fleet's family mix is glanceable. `unknown` stays muted (a per-machine alias we couldn't classify).
const LINEAGE_CHIP_CLASS: Record<FleetLineage, string> = {
	"gpt-oss": "bg-accent/12 text-accent",
	deepseek: "bg-accent-2/12 text-accent-2",
	nemotron: "bg-accent-2/12 text-accent-2",
	qwen: "bg-accent-2/12 text-accent-2",
	phi: "bg-accent-2/12 text-accent-2",
	gemma: "bg-accent-2/12 text-accent-2",
	mistral: "bg-accent-2/12 text-accent-2",
	llama: "bg-accent-2/12 text-accent-2",
	unknown: "bg-surface-3 text-text-tertiary",
};

function LivenessDot({ row }: { row: FleetRow }): React.ReactElement {
	if (row.isSpec) {
		// A `::spec` (A/B speculative) session — dashed violet ring, per the mockup's `.life.spec`.
		return (
			<span
				role="img"
				aria-label="speculative session"
				className="h-2 w-2 shrink-0 rounded-full border border-dashed border-accent-2 bg-accent-2/40"
			/>
		);
	}
	if (row.state === "running") {
		return (
			<span
				role="img"
				aria-label="running"
				className="h-2 w-2 shrink-0 rounded-full bg-status-green shadow-[0_0_7px_var(--color-status-green)]"
			/>
		);
	}
	return (
		<span
			role="img"
			aria-label="idle"
			className="h-2 w-2 shrink-0 rounded-full border border-border-bright bg-surface-4"
		/>
	);
}

function FleetRowView({ row }: { row: FleetRow }): React.ReactElement {
	const roleTag = row.role;
	return (
		<div className="grid grid-cols-[150px_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-surface-2">
			<span className="flex min-w-0 items-center gap-1.5 font-medium text-text-primary">
				<LivenessDot row={row} />
				<span className="truncate" title={row.servedId}>
					{row.servedId}
				</span>
				{roleTag ? (
					<span className={cn("rounded border px-1 text-[9px] uppercase tracking-wide", ROLE_TAG_CLASS[roleTag])}>
						{ROLE_TAG_LABEL[roleTag]}
					</span>
				) : null}
			</span>
			<span className="min-w-0">
				<span
					className={cn(
						"block truncate",
						row.state === "running" ? "text-text-secondary" : "italic text-text-tertiary",
					)}
					title={row.drivingCardTitle ?? undefined}
				>
					{row.state === "running" ? (row.drivingCardTitle ?? row.drivingTaskId ?? "running") : "idle"}
					{row.isSpec ? (
						<span className="ml-1.5 rounded border border-dashed border-accent-2/50 px-1 text-[9px] text-accent-2">
							A/B spec
						</span>
					) : null}
				</span>
				{/* §5.AB swarm legibility: the driver's LIVE step ("watch the swarm's hands") — violet = the
				    swarm's own doing (two-accent semantics). Latest step only; the Watch panel holds the log. */}
				{row.state === "running" && row.activityText ? (
					<span
						data-testid="fleet-row-activity"
						className="block truncate text-[10px] leading-4 text-accent-2/90"
						title={row.activityText}
					>
						↳ {row.activityToolName ? `${row.activityToolName} · ` : ""}
						{row.activityText}
					</span>
				) : null}
			</span>
			<span
				className={cn("justify-self-start rounded-full px-1.5 py-px text-[10px]", LINEAGE_CHIP_CLASS[row.lineage])}
			>
				{row.lineage}
			</span>
			<span
				className={cn(
					"justify-self-end text-[11px] tabular-nums",
					row.state === "idle" && row.warmKind
						? "text-status-gold"
						: row.tokensPerSecond === null
							? "text-text-tertiary"
							: "text-text-secondary",
				)}
				title={row.state === "idle" && row.warmKind ? `Prompt cache warm for ${row.warmKind} sessions` : undefined}
			>
				{row.state === "idle" && row.warmKind
					? `warm · ${row.warmKind}`
					: row.tokensPerSecond === null
						? "—"
						: `${row.tokensPerSecond} tok/s`}
			</span>
		</div>
	);
}

/**
 * One machine group: active rows (running / spec / warm) always render; idle rows condense into a single
 * lineage-mix summary line that expands on click. A wall of "idle" rows carries no signal — the ACTIVE swarm is
 * what the cockpit strip is for.
 */
function FleetGroupView({ group }: { group: FleetGroup }): React.ReactElement {
	const [idleExpanded, setIdleExpanded] = useState(false);
	const activeRows = group.rows.filter(isActiveFleetRow);
	const idleRows = group.rows.filter((row) => !isActiveFleetRow(row));
	const visibleRows = idleExpanded ? group.rows : activeRows;
	return (
		<div>
			<div className="mt-2 mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-tertiary">
				<span>{group.endpointLabel}</span>
				<span className="h-px flex-1 bg-border" />
			</div>
			{visibleRows.map((row) => (
				<FleetRowView key={`${group.endpointLabel}:${row.servedId}:${row.modelId}`} row={row} />
			))}
			{idleRows.length > 0 ? (
				<button
					type="button"
					data-testid="fleet-idle-summary"
					aria-expanded={idleExpanded}
					onClick={() => setIdleExpanded((current) => !current)}
					className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
				>
					<span className="text-[9px]">{idleExpanded ? "▾" : "▸"}</span>
					{idleExpanded ? "hide idle models" : summarizeIdleFleetRows(idleRows)}
				</button>
			) : null}
		</div>
	);
}

export function FleetStrip({ groups }: { groups: readonly FleetGroup[] }): React.ReactElement {
	if (groups.length === 0) {
		return (
			<div className="px-4 py-2 text-xs italic text-text-tertiary" data-testid="fleet-strip-empty">
				No models loaded.
			</div>
		);
	}
	return (
		<div className="max-h-[34vh] overflow-y-auto px-4 pt-0.5 pb-2.5" data-testid="fleet-strip">
			{groups.map((group) => (
				<FleetGroupView key={group.endpointLabel} group={group} />
			))}
		</div>
	);
}
