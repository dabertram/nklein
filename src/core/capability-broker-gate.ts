/**
 * Shared capability-broker GATE (§5.L) — the ONE pure decision both the chat tool executor and the swarm tool path
 * use to fail-closed a tool call. Extracted so "one broker, one gate" holds across the two seams (David decision-4:
 * wire the broker live on the swarm path too, not a second copy of the logic).
 *
 * Given a tool's capability manifest + the turn's accumulated taint, it asks: does this action touch a PROTECTED
 * influence sink (host write / network egress / elevated approval — see {@link manifestProtectedInfluenceKinds}) that
 * untrusted content already in the turn could be steering, with no trusted plan backing it? If so → DENY. A tool that
 * touches no protected sink is never blocked. With `baseline === requested` (per-tool STATIC manifest, decision-4) the
 * broker's escalation + egress sub-gates are structural no-ops here; the live rule is the taint-influence one.
 *
 * Pure + total + deterministic: no I/O, no clock, never mutates its inputs.
 */

import { brokerManifestAction } from "./capability-broker-manifest-input";
import { manifestProtectedInfluenceKinds } from "./manifest-influence-sink";
import type { TaintLabel } from "./taint-labels";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

export interface CapabilityBrokerGateInput {
	/** The tool's declared capability manifest (per-tool static). */
	manifest: ToolCapabilityManifest;
	/** The taint labels accumulated from PRIOR tool outputs this turn (untrusted content already ingested). */
	taintLabels: readonly TaintLabel[];
	/** Whether a trusted plan backs this action (relaxes the taint-influence rule). Default false (fail-closed). */
	backedByTrustedPlan?: boolean;
}

export interface CapabilityBrokerGateVerdict {
	/** True ⇒ the call may proceed to the normal access gate; false ⇒ refuse it fail-closed. */
	allow: boolean;
	/** When `allow` is false, the broker's reason for the first sink that refused. */
	reason: string | null;
}

/**
 * Decide whether the broker permits a tool call. Checks every protected influence sink the manifest touches; the FIRST
 * sink the broker refuses (given the accumulated taint + trusted-plan flag) denies the whole call. A manifest with no
 * protected sink returns allow immediately.
 */
export function decideCapabilityBrokerGate(input: CapabilityBrokerGateInput): CapabilityBrokerGateVerdict {
	for (const influence of manifestProtectedInfluenceKinds(input.manifest)) {
		const verdict = brokerManifestAction({
			baseline: input.manifest,
			requested: input.manifest,
			taintLabels: input.taintLabels,
			influence,
			backedByTrustedPlan: input.backedByTrustedPlan ?? false,
		});
		if (verdict.decision !== "allow") {
			return { allow: false, reason: verdict.reason };
		}
	}
	return { allow: true, reason: null };
}
