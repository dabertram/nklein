/**
 * Manifest ↔ run-phase gate — a thin PURE adapter (todo §5.AF, the `allowedRunStates` research-addendum concept).
 *
 * Two §5.AF cores each speak the SAME `ToolMutationLevel` vocabulary but from opposite ends: the run state machine knows
 * which mutation level a phase may offer ({@link isToolAllowedInPhase}), and the tool-capability manifest carries each
 * tool's declared `mutationLevel`. Callers that hold a WHOLE manifest (not a bare level) shouldn't have to reach inside it
 * and re-thread the field by hand at every gate site — that hand-wiring is exactly where the three drifted mechanisms
 * §5.AF exists to unify would drift again. This adapter closes the seam in ONE place: gate a manifest by phase, and filter
 * a manifest-carrying tool set to what a phase admits, so the run controller can compute a phase's offered tool subset
 * directly from each tool's manifest.
 *
 * WHY a separate file (not a method on either core): the run state machine stays free of the manifest STRUCTURE (it only
 * knows the `ToolMutationLevel` scalar), and the manifest module stays free of any run-phase concept — neither core grows
 * a dependency on the other. The adapter owns the (manifest → level) projection and nothing else. Because run-state-machine
 * already imports `ToolMutationLevel` FROM the manifest module, importing the manifest type here adds no new cycle.
 *
 * Pure + total + deterministic: no I/O, no clock, no randomness. Composes the two cores strictly by import and edits
 * neither; it is a projection + a filter, not a new decision.
 */

import { isToolAllowedInPhase, type RunPhase } from "./run-state-machine";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

/**
 * Whether a tool declaring `manifest` may be offered in `phase` — the manifest-level lift of {@link isToolAllowedInPhase}.
 * Defined AS `isToolAllowedInPhase(phase, manifest.mutationLevel)` so the two cores can never disagree: the manifest's
 * declared blast radius is fed through the phase's exact same ceiling check. The other manifest axes (network/fs/approval)
 * are NOT a run-phase concern — the phase ladder gates on mutation level alone — so this projects onto that one field.
 */
export function manifestAllowedInPhase(manifest: ToolCapabilityManifest, phase: RunPhase): boolean {
	return isToolAllowedInPhase(phase, manifest.mutationLevel);
}

/**
 * Narrow a manifest-carrying tool set to those admitted in `phase`. Generic over any tool that exposes its capability
 * `manifest` — the manifest-level counterpart to {@link selectPhaseTools} (which takes a bare `mutationLevel`), for the
 * live wiring where each tool already holds its §5.AF manifest. Filters via {@link manifestAllowedInPhase}, so the offered
 * subset is computed from the tools' declared manifests through the same single phase-ceiling rule.
 */
export function selectPhaseManifestTools<T extends { manifest: ToolCapabilityManifest }>(
	phase: RunPhase,
	tools: readonly T[],
): T[] {
	return tools.filter((tool) => manifestAllowedInPhase(tool.manifest, phase));
}
