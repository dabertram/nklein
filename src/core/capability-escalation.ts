/**
 * Capability-escalation detector (todo §5.L — "Capability broker (pure decision core)" → the fail-closed pre-check
 * "a tool requesting caps beyond its manifest → deny + reason"). PURE decision core.
 *
 * WHAT: given a tool's DECLARED baseline capability manifest (what it was admitted to do) and the REQUESTED manifest
 * for a specific invocation (what THIS call is asking to do), decide `allow | deny` per the least-privilege rule
 * "a call may use LESS power than its baseline, never MORE". It compares the two {@link ToolCapabilityManifest}s axis
 * by axis — mutation blast-radius, network reach, filesystem scope, and the approval tier — and DENIES if the request
 * escalates ABOVE the baseline on any axis, naming every escalated axis so the audit trail / broker can explain the
 * refusal precisely. A request at or below baseline on every axis is allowed (with the de-escalated axes reported, so
 * a tightened call is visible too).
 *
 * WHY / prime-directive #1 (local-only, fail-closed): the tool-capability manifest ({@link ToolCapabilityManifest}) is
 * the ceiling a tool was granted when it was admitted. An injected instruction's classic move is to smuggle a broader
 * capability into a single call — a `read` tool suddenly asking to write the host, a workspace tool reaching the
 * network, an `auto` tool trying to skip a `typed_host` confirmation. This detector is the capability broker's FIRST
 * gate (before taint/provenance/mode reasoning): if the request already exceeds the tool's own declared manifest, no
 * further context can rescue it — it is denied outright. Keeping it pure (no I/O, no SDK) mirrors
 * `tool-capability-manifest.ts` / `taint-labels.ts` / `egress-policy-decision.ts`, so the least-privilege rule lives
 * in one unit-testable place. It DECIDES only; it never performs the action.
 *
 * SCOPE (deliberate): reasons over TWO manifests only. It does NOT know the execution mode (that is
 * {@link decideManifestChatAccess}), does NOT scan content or weigh taint labels (that is `taint-labels.ts`), does NOT
 * decide egress reachability (that is `egress-policy-decision.ts`), and does NOT choose which tools a phase offers
 * (that is `run-state-machine.ts`'s phase ceiling). It answers exactly one question — "does this request stay within
 * the tool's own granted envelope?" — and composes the `tool-capability-manifest.ts` vocabulary by import without
 * editing it. `replayable` is intentionally NOT an escalation axis: it is an observation about an action, not a
 * privilege the request can grant itself (see {@link CAPABILITY_AXES}).
 */

import type {
	ToolApproval,
	ToolCapabilityManifest,
	ToolFsScope,
	ToolMutationLevel,
	ToolNetworkLevel,
} from "./tool-capability-manifest";

/**
 * Mutation blast-radius ordering (low→high), mirroring `run-state-machine.ts`'s `MUTATION_RANK` and the manifest's own
 * doc order. A request may drop DOWN this ladder (use less power) but never climb above its baseline.
 */
const MUTATION_RANK: Record<ToolMutationLevel, number> = {
	read: 0,
	sandbox_write: 1,
	control_plane: 2,
	host_write: 3,
};

/** Network-reach ordering (low→high): no reach < read-only egress < write/exfiltration egress. Reaching the network is
 * strictly more power, and a write-capable egress is strictly more power than a read-only one. */
const NETWORK_RANK: Record<ToolNetworkLevel, number> = {
	none: 0,
	egress_read: 1,
	egress: 2,
};

/** Filesystem-scope ordering (low→high): the sandbox workspace < the host filesystem. Host is strictly broader. */
const FS_SCOPE_RANK: Record<ToolFsScope, number> = {
	workspace: 0,
	host: 1,
};

/**
 * Approval-tier ordering, from "flows freely" to "hardest gate": `auto < confirm < risk_ack < typed_host`. NOTE the
 * approval axis is INVERTED relative to the other three (see {@link CAPABILITY_AXES}'s `higherIsMorePower: false`):
 * approval is a REQUIRED GATE, not a granted power, so a REQUEST asking for a LOWER tier than its baseline is the
 * escalation — it is trying to slip past a gate the tool was admitted behind (e.g. a `typed_host` tool asking to run
 * as plain `auto`). Requesting a HIGHER tier (more friction) is a de-escalation and always allowed. The rank stays in
 * natural low→high friction order; the inversion lives in the axis's direction flag, not in these numbers.
 */
const APPROVAL_RANK: Record<ToolApproval, number> = {
	auto: 0,
	confirm: 1,
	risk_ack: 2,
	typed_host: 3,
};

/** The manifest axis on which a request differed from its baseline. `replayable` is deliberately not an axis (see file doc). */
export type CapabilityAxis = "mutationLevel" | "networkLevel" | "fsScope" | "approval";

/**
 * The four capability axes compared, each with its rank ladder, human label, and direction semantics. Data-driven so a
 * new manifest axis is added in one place (and a parity test pins this to the axis set). ORDER is the reporting order:
 * mutation → network → fs → approval (roughly widest-blast-radius first).
 *
 * `higherIsMorePower` distinguishes the two kinds of axis: for mutation/network/fs a HIGHER rank means MORE power (a
 * request above baseline is the escalation); for `approval` — a required GATE, not a granted power — a LOWER tier is
 * the escalation (skipping the confirmation the tool was admitted behind), so its flag is `false`.
 */
const CAPABILITY_AXES: readonly {
	readonly axis: CapabilityAxis;
	readonly label: string;
	readonly rank: (m: ToolCapabilityManifest) => number;
	readonly value: (m: ToolCapabilityManifest) => string;
	/** True when a higher rank = more power (request-above-baseline escalates); false for a required-gate axis (approval). */
	readonly higherIsMorePower: boolean;
}[] = [
	{
		axis: "mutationLevel",
		label: "mutation blast-radius",
		rank: (m) => MUTATION_RANK[m.mutationLevel],
		value: (m) => m.mutationLevel,
		higherIsMorePower: true,
	},
	{
		axis: "networkLevel",
		label: "network reach",
		rank: (m) => NETWORK_RANK[m.networkLevel],
		value: (m) => m.networkLevel,
		higherIsMorePower: true,
	},
	{
		axis: "fsScope",
		label: "filesystem scope",
		rank: (m) => FS_SCOPE_RANK[m.fsScope],
		value: (m) => m.fsScope,
		higherIsMorePower: true,
	},
	{
		axis: "approval",
		label: "approval tier",
		rank: (m) => APPROVAL_RANK[m.approval],
		value: (m) => m.approval,
		higherIsMorePower: false,
	},
];

/** How the requested value compared to the baseline on a single axis. */
export type AxisDirection =
	/** The request asked for MORE power than the baseline grants on this axis (a violation). */
	| "escalated"
	/** The request asked for LESS power than the baseline on this axis (fine — least-privilege in action). */
	| "de_escalated"
	/** The request matched the baseline exactly on this axis. */
	| "unchanged";

/** A single axis on which the requested manifest differed from (or exceeded) the baseline. */
export interface CapabilityAxisDelta {
	axis: CapabilityAxis;
	direction: AxisDirection;
	/** The baseline (granted) value on this axis. */
	baseline: string;
	/** The requested value on this axis. */
	requested: string;
	/** Human-readable one-line explanation for the audit trail / broker prompt. */
	detail: string;
}

/** The verdict for a requested manifest against its declared baseline. */
export type CapabilityEscalationDecision = "allow" | "deny";

export interface CapabilityEscalationResult {
	decision: CapabilityEscalationDecision;
	/**
	 * Every axis the request ESCALATED above baseline (empty ⇒ allowed). Reporting order matches {@link CAPABILITY_AXES}
	 * (widest blast-radius first). This is the deny reason: the exact over-reaches, so the broker can explain "denied
	 * because it asked to write the host / reach the network / skip the confirmation".
	 */
	escalations: CapabilityAxisDelta[];
	/**
	 * Every axis the request DE-ESCALATED below baseline (used less power). Empty ⇒ the request matched or exceeded
	 * baseline on every axis. Surfaced so a tightened call is visible in the audit, not just a violating one.
	 */
	deEscalations: CapabilityAxisDelta[];
	/** One-line summary for logs / the §5.L capability-broker surface. */
	reason: string;
}

/** The per-axis label (e.g. "mutation blast-radius") — exported so callers can render an axis without re-deriving it. */
export function capabilityAxisLabel(axis: CapabilityAxis): string {
	const found = CAPABILITY_AXES.find((entry) => entry.axis === axis);
	// Every CapabilityAxis is in CAPABILITY_AXES (parity-tested), so this fallback is unreachable — kept for exhaustiveness.
	return found ? found.label : axis;
}

/**
 * Detect whether a REQUESTED capability manifest escalates beyond a tool's DECLARED baseline manifest — the capability
 * broker's fail-closed least-privilege pre-check.
 *
 * Rule: a request may use the SAME or LESS power than its baseline on every axis; asking for MORE on ANY axis is an
 * escalation and the request is DENIED. Axes: mutation blast-radius (`read < sandbox_write < control_plane <
 * host_write`), network reach (`none < egress`), filesystem scope (`workspace < host`), and approval tier
 * (`auto < confirm < risk_ack < typed_host`, where a request asking for a LOWER tier is trying to skip a gate → an
 * escalation). Each differing axis is reported with its direction, baseline/requested values, and a one-line detail;
 * `escalations` is the deny reason and `deEscalations` records where the call tightened.
 *
 * Pure + total: every field of both manifests is a value; no I/O, no ambient state. An identical baseline and request
 * (the common case) is allowed with empty deltas.
 */
export function detectCapabilityEscalation(
	baseline: ToolCapabilityManifest,
	requested: ToolCapabilityManifest,
): CapabilityEscalationResult {
	const escalations: CapabilityAxisDelta[] = [];
	const deEscalations: CapabilityAxisDelta[] = [];

	for (const entry of CAPABILITY_AXES) {
		const baseRank = entry.rank(baseline);
		const reqRank = entry.rank(requested);
		if (reqRank === baseRank) {
			continue;
		}
		const baseValue = entry.value(baseline);
		const reqValue = entry.value(requested);
		// For a power axis a HIGHER requested rank escalates; for a required-gate axis (approval) a LOWER requested rank
		// escalates (it skips the gate). Normalise to a single "is this an escalation?" test via `higherIsMorePower`.
		const escalated = entry.higherIsMorePower ? reqRank > baseRank : reqRank < baseRank;
		if (escalated) {
			escalations.push({
				axis: entry.axis,
				direction: "escalated",
				baseline: baseValue,
				requested: reqValue,
				detail: `${entry.label}: requested "${reqValue}" exceeds the granted "${baseValue}".`,
			});
		} else {
			deEscalations.push({
				axis: entry.axis,
				direction: "de_escalated",
				baseline: baseValue,
				requested: reqValue,
				detail: `${entry.label}: requested "${reqValue}" is within the granted "${baseValue}".`,
			});
		}
	}

	if (escalations.length > 0) {
		const axes = escalations.map((delta) => delta.axis).join(", ");
		return {
			decision: "deny",
			escalations,
			deEscalations,
			reason: `deny: request escalates beyond the tool's granted manifest on ${escalations.length} axis(es) (${axes}).`,
		};
	}

	const reason =
		deEscalations.length > 0
			? `allow: request stays within the granted manifest (${deEscalations.length} axis(es) tightened).`
			: "allow: request matches the tool's granted manifest exactly.";
	return { decision: "allow", escalations, deEscalations, reason };
}

/** Convenience predicate: true iff the requested manifest escalates beyond the baseline on any axis (i.e. is denied). */
export function isCapabilityEscalation(baseline: ToolCapabilityManifest, requested: ToolCapabilityManifest): boolean {
	return detectCapabilityEscalation(baseline, requested).decision === "deny";
}
