/**
 * F12.110 fleet-aware decomposition — the AVAILABLE model fleet as DIRECT decompose input, so cards are BORN
 * ROUTABLE (the capability-prior deadlock — a plan sharded into cards nobody loaded could clear — is the proven
 * failure class this kills at the source).
 *
 * David's resolved decisions (2026-07-19): the fleet snapshot is the LOADED models ONLY (production !Klein never
 * auto-loads/unloads — prompt-cache thrash, MLX especially); `smallest` targets the smallest LOADED class (an
 * optional setting may later target the supported catalog floor); fleet-change re-sharding is automatic
 * default-ON with a user opt-out (wired at the redecompose trigger, not here).
 *
 * Pure: the caller supplies the snapshot (loaded model keys + per-class worker capability/context from the
 * fitness store); this module summarizes it, picks the SHARDING TARGET per mode, and renders compact advisory
 * guidance for the decompose seed. Advisory by design — the architect still decides; guidance steers granularity
 * toward what the real executors can clear (same contract as F4.38's depth line, which this composes with).
 */

export type FleetDecompositionMode = "auto" | "smallest" | "capability_weighted" | "fixed_target" | "off";

/** Parse a configured mode with a safe default — unset/unknown ⇒ `auto` (the caller gates the feature itself). */
export function parseFleetDecompositionMode(value: string | undefined | null): FleetDecompositionMode {
	return value === "auto" ||
		value === "smallest" ||
		value === "capability_weighted" ||
		value === "fixed_target" ||
		value === "off"
		? value
		: "auto";
}

/** One LOADED model class in the snapshot. Capability/context are best-effort (null = unmeasured, prior-only). */
export interface FleetModelClassInput {
	readonly modelKey: string;
	/** Rough size in billions when parseable from the id (ranking fallback for unmeasured classes). */
	readonly paramB: number | null;
	/** Measured worker capability 0..100 from the fitness store; null when unmeasured. */
	readonly workerCapability: number | null;
	/** Quality-effective context tokens (learned knee or loaded context); null when unknown. */
	readonly effectiveContextTokens: number | null;
}

export interface FleetCapabilitySummary {
	readonly classes: readonly FleetModelClassInput[];
	/** Strongest/weakest by measured capability first, paramB fallback. Null on an empty snapshot. */
	readonly strongest: FleetModelClassInput | null;
	readonly weakest: FleetModelClassInput | null;
}

function classRank(entry: FleetModelClassInput): number {
	if (entry.workerCapability !== null) {
		return entry.workerCapability;
	}
	// Unmeasured: paramB as a weak prior on a lower band so measured classes outrank same-size unknowns.
	return entry.paramB !== null ? Math.min(49, entry.paramB) : 0;
}

/** Summarize the loaded snapshot: dedupe by modelKey, rank, name the strongest/weakest classes. */
export function buildFleetCapabilitySummary(classes: readonly FleetModelClassInput[]): FleetCapabilitySummary {
	const byKey = new Map<string, FleetModelClassInput>();
	for (const entry of classes) {
		if (entry.modelKey.trim().length > 0 && !byKey.has(entry.modelKey)) {
			byKey.set(entry.modelKey, entry);
		}
	}
	const deduped = [...byKey.values()].sort((left, right) => classRank(right) - classRank(left));
	return {
		classes: deduped,
		strongest: deduped[0] ?? null,
		weakest: deduped.at(-1) ?? null,
	};
}

/** The class whose effective context should drive the F4.38 depth decision for a given mode. */
export function selectDepthTargetClass(
	summary: FleetCapabilitySummary,
	mode: FleetDecompositionMode,
	fixedTargetModelKey?: string | null,
): FleetModelClassInput | null {
	if (mode === "off" || summary.classes.length === 0) {
		return null;
	}
	if (mode === "fixed_target" && fixedTargetModelKey) {
		return summary.classes.find((entry) => entry.modelKey === fixedTargetModelKey) ?? summary.weakest;
	}
	if (mode === "smallest") {
		return summary.weakest;
	}
	// auto / capability_weighted: shard so the BULK of cards fits the weaker half while big cards can target the
	// strongest — depth follows the weakest class (cards must be clearable fleet-wide), mix guidance does the rest.
	return summary.weakest;
}

function describeClass(entry: FleetModelClassInput): string {
	const size = entry.paramB !== null ? `~${entry.paramB}B` : "size unknown";
	const cap = entry.workerCapability !== null ? `capability ${Math.round(entry.workerCapability)}` : "unmeasured";
	return `${entry.modelKey} (${size}, ${cap})`;
}

/**
 * Render the advisory fleet block for the decompose seed. Empty array when mode is `off` or the snapshot is
 * empty (byte-identical prompt). Capped at the summary line + per-mode instruction + ≤4 named classes so a big
 * fleet cannot blow the instruction budget.
 */
export function buildFleetDecompositionGuidance(
	summary: FleetCapabilitySummary,
	mode: FleetDecompositionMode,
	fixedTargetModelKey?: string | null,
): string[] {
	if (mode === "off" || summary.classes.length === 0) {
		return [];
	}
	const named = summary.classes.slice(0, 4).map(describeClass).join("; ");
	const extra = summary.classes.length > 4 ? ` (+${summary.classes.length - 4} more)` : "";
	const header = `Available model fleet (LOADED, ${summary.classes.length} class(es)): ${named}${extra}.`;
	if (mode === "smallest") {
		return [
			header,
			`Fleet sharding (SMALLEST mode): size EVERY card so the weakest class — ${summary.weakest ? describeClass(summary.weakest) : "n/a"} — can complete it alone: tight scope, one focused change per card, explicit acceptance checks. More small cards beats fewer large ones here.`,
		];
	}
	if (mode === "fixed_target") {
		const target = fixedTargetModelKey
			? (summary.classes.find((entry) => entry.modelKey === fixedTargetModelKey) ?? null)
			: null;
		return [
			header,
			`Fleet sharding (FIXED-TARGET mode): size every card for ${target ? describeClass(target) : (fixedTargetModelKey ?? "the named class")} regardless of the rest of the fleet.`,
		];
	}
	// auto / capability_weighted — the mixed shape.
	const strongest = summary.strongest ? describeClass(summary.strongest) : "the strongest class";
	const weakest = summary.weakest ? describeClass(summary.weakest) : "the weakest class";
	return [
		header,
		`Fleet sharding (MIXED mode): shard a MIX — reserve the few genuinely complex, cross-cutting cards for ${strongest} (mark them with a higher difficulty), and size the bulk of the cards so ${weakest} can complete each one alone (tight scope, explicit acceptance checks). Every card must be completable by at least one loaded class.`,
	];
}
