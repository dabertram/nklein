/**
 * Outward-action approval decision (Phase 7S / S3) — PURE decision core.
 *
 * WHAT: S3 says no agent holds unrestricted write/egress/post rights — an effectful, OUTWARD-FACING, or IRREVERSIBLE
 * action (post a comment/PR via MCP, egress-write, delete/overwrite, a permission/settings change) needs explicit
 * approval OR a pre-authorized, narrowly-scoped policy, never a bare default grant. The existing capability-broker gate
 * ([capability-broker-gate.ts](./capability-broker-gate.ts)) is BINARY (allow/deny) on the taint-influence rule; this
 * core adds the missing middle outcome — `require_approval` — and the pre-authorization concept, so the system can ask a
 * human for an outward action instead of only hard-denying or silently allowing it. It CONSUMES the taint backbone (S5):
 * whether untrusted content is in context, and whether a trusted plan backs the action.
 *
 * WHY pure: like the rest of §5.L, a total deterministic predicate (no I/O, no clock) is unit-testable and serves every
 * seam. The three-way result is mapped to a concrete behavior at each seam — the interactive chat path routes
 * `require_approval` to the confirm-dialog, while an AUTONOMOUS swarm run (no human mid-run) maps it fail-closed via
 * {@link resolveAutonomousApproval}. Keeping the DECISION here means both seams share one rule.
 */

export type ApprovalDecision = "allow" | "require_approval" | "deny";

export interface OutwardActionInput {
	/**
	 * Whether this action reaches OUTWARD or is IRREVERSIBLE — posts to an external service, egress-WRITES, deletes/
	 * overwrites, or changes permissions/settings. A read or a contained sandbox write is NOT outward and always allows.
	 */
	readonly isOutwardOrIrreversible: boolean;
	/** Whether untrusted content is present in the context (from the S5 taint labels — `isTainted`). */
	readonly contextTainted: boolean;
	/** Whether a trusted plan + operator confirmation backs this action (the §5.L trust anchor that relaxes the taint rule). */
	readonly backedByTrustedPlan: boolean;
	/**
	 * Whether the action's scope matches a pre-authorized, NARROWLY-scoped policy (e.g. "may comment on issues in THIS
	 * repo"). A pre-authorization is the standing, bounded grant that lets a routine outward action proceed without a
	 * fresh human prompt. Absent ⇒ false (fail-closed: no default grant).
	 */
	readonly preAuthorized?: boolean;
}

export interface OutwardActionApprovalResult {
	readonly decision: ApprovalDecision;
	/** One operator-facing sentence explaining the decision. */
	readonly reason: string;
}

/**
 * S3 decision:
 *  1. Not outward/irreversible → `allow` (a read or contained write needs no approval).
 *  2. Outward + tainted context + NOT backed by a trusted plan → `deny` — untrusted content must never drive an outward
 *     action on its own (the §5.L invariant); a pre-authorization does NOT override a live taint, only a trusted plan does.
 *  3. Outward + (pre-authorized OR trusted-plan-backed) → `allow` — a bounded standing grant or an operator-confirmed plan.
 *  4. Outward, untainted, no pre-auth, no plan → `require_approval` — the human-in-the-loop case for a novel outward act.
 */
export function decideOutwardActionApproval(input: OutwardActionInput): OutwardActionApprovalResult {
	if (!input.isOutwardOrIrreversible) {
		return { decision: "allow", reason: "action is neither outward-facing nor irreversible; no approval needed." };
	}
	// A live taint can only be cleared by a trusted plan — never by a standing pre-authorization (which is scoped to
	// routine, non-adversarial use). This keeps the S5.L rule: tainted content can't steer an outward action.
	if (input.contextTainted && !input.backedByTrustedPlan) {
		return {
			decision: "deny",
			reason:
				"outward action refused: untrusted content is in context and no trusted plan backs it — an injection could be " +
				"steering this action.",
		};
	}
	if (input.preAuthorized || input.backedByTrustedPlan) {
		return {
			decision: "allow",
			reason: input.backedByTrustedPlan
				? "outward action allowed: a trusted plan + operator confirmation backs it."
				: "outward action allowed: it matches a pre-authorized, narrowly-scoped policy.",
		};
	}
	return {
		decision: "require_approval",
		reason: "outward action needs operator approval: it is effectful/irreversible and not pre-authorized.",
	};
}

/**
 * Map the three-way decision to a binary outcome for an AUTONOMOUS run where there is no human to approve mid-run.
 * `require_approval` becomes `false` (fail-closed) — an unattended agent must not perform a novel outward action that
 * would otherwise wait on a human; it either was pre-authorized (→ allow) or it waits for the operator to run it.
 */
export function resolveAutonomousApproval(decision: ApprovalDecision): boolean {
	return decision === "allow";
}
