/**
 * Capability-broker FROM-MANIFEST constructor (todo §5.AF — the ergonomic manifest adapter for the §5.L keystone).
 * PURE, deterministic, composes {@link decideCapabilityAction} strictly BY IMPORT.
 *
 * WHAT: the capability broker ({@link decideCapabilityAction}) is the ONE seam between the model and every tool, but its
 * input ({@link CapabilityBrokerInput}) is a multi-field record stitched from four different §5.L cores — two capability
 * manifests, the taint labels + protected-influence kind + trusted-plan flag, and an optional egress request. Callers at
 * the model↔tool seam already hold exactly these pieces, but hand-assembling the record at every call site invites drift:
 * a forgotten `influence` default, a mis-wired `backedByTrustedPlan`, an egress field placed on the wrong object. This
 * module is the single named constructor that maps those pieces into the broker's input shape — so a call site says WHAT
 * it has (a baseline, a requested manifest, the surrounding taint/plan/egress context) and never how the broker packs it.
 *
 * WHY: {@link CapabilityBrokerInput} is authoritative — this adapter adds ZERO policy of its own. It is a pure shape
 * mapping: every field is copied through 1:1, the two optional context fields keep the broker's own defaults (an absent
 * `influence` still defaults to `style` INSIDE the broker, an absent `backedByTrustedPlan` still reads as `false`, an
 * absent `egress` still skips the egress gate). Because it is a straight projection, the broker's load-bearing precedence
 * (raw escalation → deny; tainted protected influence w/o plan → require_fresh_trusted_plan; egress confirm →
 * one_time_confirm; else allow) is reproduced EXACTLY through the adapter — the characterization test pins that.
 *
 * SCOPE (deliberate): it constructs an input and (via {@link brokerManifestAction}) forwards to the broker. It decides
 * NOTHING itself — no taint reasoning, no escalation math, no egress rule. Pure + total + deterministic: no I/O, no clock,
 * no randomness. It edits none of the composed cores.
 */

import { type CapabilityBrokerInput, type CapabilityBrokerResult, decideCapabilityAction } from "./capability-broker";
import type { EgressPolicyRequest } from "./egress-policy-decision";
import type { InfluenceKind, TaintLabel } from "./taint-labels";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

/**
 * The ergonomic argument bag for constructing a {@link CapabilityBrokerInput} from the pieces a model↔tool seam already
 * holds. Field-for-field the broker's own input (so no information is lost and no policy is injected), named here as a
 * dedicated adapter surface: a caller supplies the two manifests plus the taint/influence/plan/egress context, and the
 * constructor packs them into the exact record the broker consumes.
 */
export interface BrokerManifestArgs {
	/** The tool's DECLARED baseline manifest — the ceiling it was admitted to operate within. */
	baseline: ToolCapabilityManifest;
	/** The REQUESTED per-call manifest — what THIS invocation is asking to do. */
	requested: ToolCapabilityManifest;
	/** The taint labels currently on the context proposing this action (web/repo/MCP/… accumulate here). */
	taintLabels: readonly TaintLabel[];
	/**
	 * What protected effect (if any) the context is trying to exert. Omitted ⇒ the broker treats it as the benign,
	 * non-protected `style` influence that never trips the trusted-plan gate. Passed through untouched.
	 */
	influence?: InfluenceKind;
	/**
	 * Whether a trusted plan + human confirmation backs a PROTECTED influence — the ONE gate that lets tainted content
	 * reach a protected sink. Omitted ⇒ the broker reads it as `false`. Passed through untouched.
	 */
	backedByTrustedPlan?: boolean;
	/**
	 * The outbound egress request, present ONLY when this action reaches the network. Omitted ⇒ the broker skips the
	 * egress gate entirely. Passed through untouched.
	 */
	egress?: EgressPolicyRequest;
}

/**
 * Build a {@link CapabilityBrokerInput} from the manifest + context pieces a caller already holds. A pure 1:1 projection:
 * the two manifests, the taint labels, and the three optional context fields are copied through exactly as-is, so the
 * broker's own defaults (influence → `style`, backedByTrustedPlan → `false`, absent egress → gate skipped) apply
 * unchanged. Adds no policy — it exists purely so call sites stop hand-assembling the broker's multi-field record.
 */
export function capabilityBrokerInputFromManifest(args: BrokerManifestArgs): CapabilityBrokerInput {
	return {
		baseline: args.baseline,
		requested: args.requested,
		taintLabels: args.taintLabels,
		influence: args.influence,
		backedByTrustedPlan: args.backedByTrustedPlan,
		egress: args.egress,
	};
}

/**
 * The one-call convenience: construct the broker input from the manifest pieces and DECIDE, returning the broker's full
 * {@link CapabilityBrokerResult} (verdict + reason + any `escalatedAxes`). Exactly
 * `decideCapabilityAction(capabilityBrokerInputFromManifest(args))` — the ergonomic path so a seam that just wants the
 * verdict never touches the intermediate input shape. Reproduces the broker's precedence verbatim (it IS the broker).
 */
export function brokerManifestAction(args: BrokerManifestArgs): CapabilityBrokerResult {
	return decideCapabilityAction(capabilityBrokerInputFromManifest(args));
}
