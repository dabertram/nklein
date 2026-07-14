import type { OccupancyPressureDecision, OccupancyZone } from "./context-occupancy-pressure";

/**
 * F4.14 (pure core / a-leaf) — context-pressure TRIAGE: at runtime, decide `continue` / `compact` / `stop` for a turn
 * under context pressure. Composes the shipped occupancy decision (`decideContextOccupancy` →
 * {@link OccupancyPressureDecision}, which only does compact/proceed/expand on SPACE) with the higher-level signals a
 * runtime loop also has — the learned quality budget (are we past the knee, not just full?), pending work (is stopping
 * clean or a park?), and a degenerate-behaviour flag — and adds the `stop` verdict the occupancy core has no notion of.
 *
 * `stop` is the escalation the space-only decision can't express: context pressure that COMPACTION CANNOT RECOVER
 * (nothing left to trim) or a turn already misbehaving, where continuing just burns budget. Pure + deterministic; the
 * runtime-loop wiring + live/simulator bounded-behaviour proof are the b-leaf.
 */

export type ContextTriageAction = "continue" | "compact" | "stop";

export interface ContextPressureTriageInput {
	/** The shipped space-occupancy verdict for this turn (from `decideContextOccupancy`). */
	occupancy: OccupancyPressureDecision;
	/** Context has passed the learned quality-effective budget (F4.10 knee) — quality is degrading, not just space filling. */
	qualityBudgetExceeded?: boolean;
	/** Remaining pending work (tool steps). 0 ⇒ a clean stopping point; >0 ⇒ a `stop` is a PARK, surfaced in the reason. */
	pendingWorkItems: number;
	/** The turn is already misbehaving (loop/runaway/timeout, from F3.1/F3.5) — feeding or trimming context won't recover it. */
	degenerateBehavior?: boolean;
}

export interface ContextPressureTriage {
	action: ContextTriageAction;
	reason: string;
	/** When `action` is `compact`, the zones to trim (most-trimmable first), passed through from the occupancy decision. */
	trimZoneOrder: OccupancyZone[];
}

/** Whether the occupancy decision still has tokens it could shed (a compaction would actually recover headroom). */
function canCompact(occupancy: OccupancyPressureDecision): boolean {
	return occupancy.trimZoneOrder.length > 0;
}

function parkNote(pendingWorkItems: number): string {
	return pendingWorkItems > 0 ? ` (park — ${pendingWorkItems} pending item(s))` : " (clean stop — no pending work)";
}

export function triageContextPressure(input: ContextPressureTriageInput): ContextPressureTriage {
	const { occupancy } = input;

	// A degenerate turn under real space pressure: neither compacting nor continuing recovers it — stop (and park any
	// pending work). Gated on actual `compact`-level pressure so a healthy turn with a transient blip isn't killed here
	// (loop/runaway interruption proper is F3.1/F3.5's job; this only escalates the CONTEXT-pressure path).
	if (input.degenerateBehavior && occupancy.action === "compact") {
		return {
			action: "stop",
			reason: `degenerate turn at ${Math.round(occupancy.usedFraction * 100)}% occupancy — compaction won't recover it${parkNote(input.pendingWorkItems)}`,
			trimZoneOrder: [],
		};
	}

	if (occupancy.action === "compact") {
		if (canCompact(occupancy)) {
			return {
				action: "compact",
				reason: `occupancy ${Math.round(occupancy.usedFraction * 100)}% over the compact ceiling — shed ${occupancy.trimZoneOrder.join("→")} first`,
				trimZoneOrder: occupancy.trimZoneOrder,
			};
		}
		// Over the ceiling with NOTHING left to trim — unrecoverable context pressure.
		return {
			action: "stop",
			reason: `occupancy ${Math.round(occupancy.usedFraction * 100)}% with nothing left to compact — unrecoverable${parkNote(input.pendingWorkItems)}`,
			trimZoneOrder: [],
		};
	}

	// Space is fine (proceed/expand). If we're past the learned QUALITY knee, trim toward it when we can — filling the
	// advertised window past the knee degrades answers even though there is nominal space. If there's nothing to trim,
	// there's no recovery lever here, so continue (a bigger hammer — model/window routing — is a different item).
	if (input.qualityBudgetExceeded) {
		if (canCompact(occupancy)) {
			return {
				action: "compact",
				reason: `past the learned quality budget at ${Math.round(occupancy.usedFraction * 100)}% — trim toward the knee`,
				trimZoneOrder: occupancy.trimZoneOrder,
			};
		}
		return {
			action: "continue",
			reason: "past the learned quality budget but nothing left to trim — continue",
			trimZoneOrder: [],
		};
	}

	return {
		action: "continue",
		reason: `occupancy ${Math.round(occupancy.usedFraction * 100)}% in the productive band — continue`,
		trimZoneOrder: [],
	};
}
