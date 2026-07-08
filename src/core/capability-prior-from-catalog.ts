/**
 * §5.AB capability PRIOR from the §5.AL catalog — the principled complement to the best-effort routing bridge
 * (`CAPABILITY_BEST_EFFORT_MARGIN`). The sweep found that a COLD fleet all sits at the flat `DEFAULT_CAPABILITY_PRIOR`
 * (35), so any "medium" card (difficulty ≥ 36) can only run via the bridge. This module derives a DIFFERENTIATED prior
 * from what !Klein already KNOWS about a model family — its curated tool-use verdict, multi-step chaining strength, and
 * resident size — so a known-good big coder priors ABOVE medium and clears those cards outright, while a reasoning-only
 * / tool-unsuitable family priors below and an UNKNOWN family falls back to the flat default (the bridge still covers
 * the truly-unstudied cold case). Pure + total + deterministic; the registry-stats entry-creation path seeds
 * `staticPrior` from this instead of the flat constant.
 */

import { DEFAULT_CAPABILITY_PRIOR } from "../nklein-agent/nklein-model-registry-scoring.js";
import { lookupModelCapability, type ModelCapabilityEntry } from "./model-capability-catalog.js";

/** Base prior by headline tool-use verdict. UNKNOWN defers to the flat default (unstudied ⇒ no opinion). */
function basePriorForVerdict(entry: ModelCapabilityEntry): number {
	switch (entry.toolUse) {
		case "TOOL_NATIVE":
			return 55;
		case "TOOL_CAPABLE":
			return 45;
		case "TOOL_WEAK":
			return 30;
		case "TOOL_UNSUITABLE":
			return 15;
		case "UNKNOWN":
			return DEFAULT_CAPABILITY_PRIOR;
	}
}

/** Multi-step chaining is the axis that best predicts an unattended agentic run — nudge the prior by it. */
function chainingAdjustment(entry: ModelCapabilityEntry): number {
	switch (entry.chaining) {
		case "native":
			return 5;
		case "via_force":
			return 0;
		case "single_only":
			return -5;
		case "fails":
			return -10;
		default:
			return 0; // unknown / unset
	}
}

/**
 * A small monotonic size bonus (bigger resident footprint ⇒ more headroom): +1 per ~6GB, capped at +8, so a 27B
 * (~16GB) gets ~+2 and a 96GB MoE ~+8 while a 4B (~3GB) gets 0. Deliberately modest — verdict + chaining dominate; size
 * only breaks near-ties between same-verdict families.
 */
function sizeBonus(entry: ModelCapabilityEntry): number {
	if (typeof entry.sizeGb !== "number" || !Number.isFinite(entry.sizeGb) || entry.sizeGb <= 0) {
		return 0;
	}
	return Math.min(8, Math.floor(entry.sizeGb / 6));
}

function clampPrior(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Derive a 0-100 capability prior for a catalog entry: base(verdict) + chaining nudge + a modest size bonus, clamped.
 * A TOOL_NATIVE, natively-chaining coder clears the "medium" difficulty band (≥36) outright; a TOOL_UNSUITABLE
 * reasoning family stays well below it. Pure.
 */
export function capabilityPriorForCatalogEntry(entry: ModelCapabilityEntry): number {
	return clampPrior(basePriorForVerdict(entry) + chainingAdjustment(entry) + sizeBonus(entry));
}

/**
 * Derive the capability prior for a model id by looking it up in the §5.AL catalog (user overlay first, then shipped);
 * an UNKNOWN family (no catalog match) falls back to the flat {@link DEFAULT_CAPABILITY_PRIOR} — the best-effort
 * routing bridge covers that truly-unstudied cold case. The registry seeds `staticPrior` from this.
 */
export function deriveCapabilityPrior(modelId: string): number {
	const entry = lookupModelCapability(modelId);
	return entry ? capabilityPriorForCatalogEntry(entry) : DEFAULT_CAPABILITY_PRIOR;
}
