/**
 * Capability broker — the §5.L context-aware decision core (todo §5.L "Capability broker (pure decision core)" → the
 * leaf "implement the decision: `allow | deny | one-time-confirm | require-fresh-trusted-plan`; unit-test the matrix").
 * PURE decision core.
 *
 * WHAT: given ONE requested tool action — the tool's DECLARED baseline manifest, the REQUESTED per-call manifest, the
 * taint labels on the context proposing the action, WHAT protected effect (if any) that context is trying to exert, and
 * the outbound egress inputs — decide a single verdict:
 *
 *   - `deny`                        — the request escalates BEYOND the tool's own granted manifest on some axis. No
 *                                     context can rescue a raw capability escalation; it is refused outright.
 *   - `require_fresh_trusted_plan`  — tainted (web/repo/MCP/secret_like) context is trying to move a PROTECTED sink
 *                                     (capabilities/approvals/network/secrets/git-delivery/host) WITHOUT a trusted plan
 *                                     + confirmation. The action is not forbidden — but it must first be re-grounded in
 *                                     a fresh, operator-authored plan, never in a bare instruction lifted from content.
 *   - `one_time_confirm`           — nothing above objects, but the egress policy says this outbound host needs an
 *                                     explicit, logged per-action approval before it flows.
 *   - `allow`                      — none of the gates fired: the call stays within its manifest, its influence is
 *                                     benign (or trusted-plan-backed), and egress (if any) flows freely.
 *
 * WHY / prime-directive #1 (local-only, fail-closed): §5.L assumes prompt injection SUCCEEDS and protects the SINKS.
 * The broker is the ONE seam between the model and every tool. It composes the three already-proven §5.L pure cores —
 * {@link detectCapabilityEscalation} (least-privilege manifest pre-check), {@link taintedContentMayInfluence} (the
 * "untrusted content guides STYLE only" rule), and {@link decideEgressPolicy} (the egress allow/deny/confirm rule) — and
 * layers them in the ONE precedence the spec pins down. The ORDER is load-bearing (see {@link decideCapabilityAction}):
 * a manifest escalation is checked FIRST because no amount of taint/plan/egress context may rescue a tool asking for
 * power it was never granted; the trusted-plan gate is checked BEFORE the softer egress confirm because re-grounding a
 * protected influence is a stronger requirement than a per-action approval.
 *
 * SCOPE (deliberate): reasons over the injected inputs ONLY — it DECIDES, it never performs the action, opens a socket,
 * scans content, or resolves a mode. It composes the three cores strictly BY IMPORT and edits none of them. Pure +
 * total + deterministic: no I/O, no ambient clock, no randomness. This is the DECIDE-only leaf; wiring it at the actual
 * model↔tool seam (so every tool call passes through it) is a separate, later slice.
 */

import { type CapabilityAxis, detectCapabilityEscalation, isCapabilityEscalation } from "./capability-escalation";
import { decideEgressPolicy, type EgressPolicyRequest } from "./egress-policy-decision";
import { type InfluenceKind, type TaintLabel, taintedContentMayInfluence } from "./taint-labels";
import type { ToolCapabilityManifest } from "./tool-capability-manifest";

/**
 * The broker's verdict set, exactly per §5.L. A superset of the composed sub-cores' enums: `deny`/`allow` map through,
 * `require_fresh_trusted_plan` is the taint-without-plan outcome (from {@link taintedContentMayInfluence} returning
 * false), and `one_time_confirm` is the egress `confirm` tier (from {@link decideEgressPolicy}).
 */
export type CapabilityBrokerDecision =
	/** Stay within the manifest, benign/plan-backed influence, egress (if any) flows — the action may proceed. */
	| "allow"
	/** The request escalates beyond the tool's granted manifest — refused outright; no context rescues it. */
	| "deny"
	/** Permitted, but the outbound host needs an explicit, logged per-action approval before it flows. */
	| "one_time_confirm"
	/** Tainted content is trying to move a protected sink with no trusted plan — must be re-grounded first. */
	| "require_fresh_trusted_plan";

/**
 * The broker's input for a SINGLE requested tool action. Everything the decision needs is injected — no ambient config,
 * no I/O. Mirrors the §5.L broker input `{ ruleset, role, provenance, tool trust, taint labels, action, target,
 * is-sink? }`, reduced to the fields the three composed cores actually consume:
 *  - the two manifests feed the least-privilege escalation pre-check,
 *  - the taint labels + protected-influence kind + trusted-plan flag feed the STYLE-only rule,
 *  - the egress request (present only when the action reaches outward) feeds the egress rule.
 */
export interface CapabilityBrokerInput {
	/** The tool's DECLARED baseline manifest — the ceiling it was admitted to operate within. */
	baseline: ToolCapabilityManifest;
	/** The REQUESTED per-call manifest — what THIS invocation is asking to do. */
	requested: ToolCapabilityManifest;
	/** The taint labels currently on the context proposing this action (web/repo/MCP/... accumulate here). */
	taintLabels: readonly TaintLabel[];
	/**
	 * What protected effect (if any) the context is trying to exert. `style` (the default) is a benign, non-protected
	 * influence that never trips the trusted-plan gate; a protected kind engages the §5.L "untrusted guides STYLE only"
	 * rule. Defaults to `style` so an action that isn't touching a sink is trivially past this gate.
	 */
	influence?: InfluenceKind;
	/**
	 * Whether a trusted plan + human confirmation backs a PROTECTED influence. Only a caller that has genuinely obtained
	 * the plan + confirmation may set this — it is the ONE gate that lets tainted content reach a protected sink.
	 */
	backedByTrustedPlan?: boolean;
	/**
	 * The outbound egress request, present ONLY when this action reaches the network. Absent ⇒ the action performs no
	 * egress and the egress gate is skipped entirely. When present, its `confirm` verdict becomes the broker's
	 * `one_time_confirm`, and its `deny` (an egress refusal) also denies the whole action — egress is fail-closed too.
	 */
	egress?: EgressPolicyRequest;
}

/** The broker's full verdict, with the reason and (for a manifest escalation) the exact over-reached axes. */
export interface CapabilityBrokerResult {
	decision: CapabilityBrokerDecision;
	/** One-line explanation for the audit trail / the model↔tool seam surface. */
	reason: string;
	/**
	 * Present ONLY on a `deny` caused by a manifest escalation: every axis the request escalated above baseline (mutation
	 * blast-radius / network reach / filesystem scope / approval-gate skip), so the refusal can be explained precisely.
	 */
	escalatedAxes?: CapabilityAxis[];
}

/**
 * THE §5.L CAPABILITY-BROKER DECISION, as a pure function. Precedence (fail-closed at every step, per todo §5.L):
 *
 *   1. **Raw capability escalation → `deny`.** If the REQUESTED manifest escalates beyond the tool's DECLARED baseline
 *      on ANY axis ({@link isCapabilityEscalation}), the action is refused outright with `escalatedAxes` — NO taint,
 *      plan, or egress context can rescue a tool asking for power it was never granted. This is the broker's first,
 *      hardest gate (mirrors `capability-escalation.ts`'s own doc: "if the request already exceeds the tool's own
 *      declared manifest, no further context can rescue it").
 *
 *   2. **Protected influence from tainted content, no trusted plan → `require_fresh_trusted_plan`.** If the context is
 *      tainted and is trying to move a PROTECTED sink WITHOUT a trusted plan + confirmation
 *      ({@link taintedContentMayInfluence} returns false), the action isn't forbidden — but it must be re-grounded in a
 *      fresh, operator-authored plan before it may proceed. A `style`-class (benign) influence, an untainted context, or
 *      a genuinely plan-backed influence all pass this gate.
 *
 *   3. **Egress says confirm → `one_time_confirm`.** When the action reaches outward and {@link decideEgressPolicy}
 *      returns `confirm` (a permitted public host behind a per-action approval), the broker surfaces that as a one-time
 *      confirmation. An egress `deny` (an inward-pivot / off-allowlist / no-egress refusal) ALSO denies the whole action
 *      — egress is fail-closed. No egress request ⇒ this gate is skipped.
 *
 *   4. **Otherwise → `allow`.** Within manifest, benign/plan-backed influence, egress (if any) flows freely.
 *
 * Pure + total: every field is a value; no I/O, no ambient state, no clock, no randomness.
 */
export function decideCapabilityAction(input: CapabilityBrokerInput): CapabilityBrokerResult {
	// 1. Raw capability escalation — refused outright, no context rescues it.
	if (isCapabilityEscalation(input.baseline, input.requested)) {
		const escalation = detectCapabilityEscalation(input.baseline, input.requested);
		const escalatedAxes = escalation.escalations.map((delta) => delta.axis);
		return {
			decision: "deny",
			reason: escalation.reason,
			escalatedAxes,
		};
	}

	// 2. Tainted content trying to move a protected sink without a trusted plan — must be re-grounded first.
	const influence: InfluenceKind = input.influence ?? "style";
	const influenceAllowed = taintedContentMayInfluence({
		labels: input.taintLabels,
		influence,
		backedByTrustedPlanAndConfirmation: input.backedByTrustedPlan === true,
	});
	if (!influenceAllowed) {
		return {
			decision: "require_fresh_trusted_plan",
			reason: `require_fresh_trusted_plan: tainted content may not move the protected "${influence}" sink without a fresh trusted plan + confirmation.`,
		};
	}

	// 3. Egress gate (only when the action reaches outward). `confirm` → one-time confirm; `deny` → fail-closed deny.
	if (input.egress !== undefined) {
		const egress = decideEgressPolicy(input.egress);
		if (egress.decision === "deny") {
			return {
				decision: "deny",
				reason: `deny: egress refused — ${egress.reason}`,
			};
		}
		if (egress.decision === "confirm") {
			return {
				decision: "one_time_confirm",
				reason: `one_time_confirm: egress permitted but gated — ${egress.reason}`,
			};
		}
	}

	// 4. Nothing objected — the action may proceed.
	return {
		decision: "allow",
		reason: "allow: request stays within its manifest, influence is permitted, and egress (if any) flows freely.",
	};
}
