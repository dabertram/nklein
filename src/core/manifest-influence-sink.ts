/**
 * Manifest → protected-influence-sink adapter (todo §5.AF manifest × §5.L sinks) — PURE decision core.
 *
 * WHAT: given a tool's {@link ToolCapabilityManifest} (the §5.AF one vocabulary that describes an action's blast
 * radius), classify which of the §5.L PROTECTED influence sinks that action actually TOUCHES —
 * {@link manifestProtectedInfluenceKinds} returns a deduped list of {@link ProtectedInfluenceKind}.
 *
 * WHY: the §5.L taint rule ({@link taintedContentMayInfluence}) reasons over an {@link InfluenceKind} — "what
 * protected effect is this influence trying to exert?" — but the answer for a TOOL action is latent in its manifest:
 * a manifest that can reach `egress` is exactly an influence on the NETWORK sink; one that can write the host is an
 * influence on the HOST-ACCESS sink; one gated behind the typed host-escape / risk-ack is an influence on the
 * APPROVALS sink. Encoding that projection ONCE, purely, means a taint rule (or the capability broker) can derive the
 * protected sinks straight off a tool manifest instead of every call site re-deriving them and drifting apart —
 * the same "one manifest, one gate" discipline §5.AF exists to enforce.
 *
 * SCOPE (deliberate): a total, deterministic PROJECTION over manifest fields — no I/O, no clock, no randomness, no
 * content scanning. It composes {@link ProtectedInfluenceKind} / {@link isProtectedInfluence} strictly BY IMPORT from
 * `taint-labels.ts` (which has zero imports → zero cycle risk) and reads the manifest type from
 * `tool-capability-manifest.ts`. It does NOT decide whether the influence is PERMITTED (that is the taint rule / the
 * broker) — it only names the sinks the action's declared power lands on. A plain sandbox read touches no protected
 * sink and yields `[]`. NOTE the deliberate NON-mappings: `capabilities`, `secrets`, and `git_delivery` are §5.L sinks
 * that the current three-axis manifest cannot express (they are per-action / content-scope concerns layered on top),
 * so they are never returned here — they belong to a later manifest slice, not to this projection.
 */

import { isProtectedInfluence, type ProtectedInfluenceKind } from "./taint-labels";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

/**
 * The protected §5.L influence sink(s) a manifested action touches, derived purely from the manifest's blast-radius
 * axes. The mapping (each axis-condition → the REAL {@link ProtectedInfluenceKind} member it lands on):
 *
 *  - `networkLevel === "egress"`                          → `"network"`     (the action can reach the network).
 *  - `fsScope === "host"` OR `mutationLevel === "host_write"` → `"host_access"` (the action can reach the host).
 *  - `approval === "typed_host"` OR `approval === "risk_ack"` → `"approvals"`   (the action rides an elevated approval
 *                                                                                gate — it moves the approvals sink).
 *
 * Returns a DEDUPED list (a manifest that is both `egress` and `host_write`, say, yields `["network","host_access"]`
 * once each) in a stable, declaration order. Every returned kind is guaranteed {@link isProtectedInfluence}-true by
 * construction — the function only ever emits members of {@link ProtectedInfluenceKind}. An action whose manifest
 * trips none of the conditions (e.g. a plain workspace read) touches NO protected sink and returns `[]`.
 */
export function manifestProtectedInfluenceKinds(manifest: ToolCapabilityManifest): ProtectedInfluenceKind[] {
	const kinds = new Set<ProtectedInfluenceKind>();

	// Network reach — an egress-capable action lands on the network sink.
	if (manifest.networkLevel === "egress") {
		kinds.add("network");
	}

	// Host reach — a host-scoped filesystem OR a host mutation lands on the host-access sink. Either axis alone is
	// enough (a host READ is fsScope:"host" without host_write; a host_write is host_write mutation), so OR them.
	if (manifest.fsScope === "host" || manifest.mutationLevel === "host_write") {
		kinds.add("host_access");
	}

	// Elevated approval — the typed host-escape phrase or an explicit risk-acknowledgement means the action rides the
	// approvals sink (a plain `auto`/`confirm` gate is not a protected-sink escalation).
	if (manifest.approval === "typed_host" || manifest.approval === "risk_ack") {
		kinds.add("approvals");
	}

	// Total by construction: every added member is a ProtectedInfluenceKind, so the filter is a belt-and-braces
	// invariant (never actually drops anything) that also proves the return type to the reader.
	return [...kinds].filter(isProtectedInfluence);
}
