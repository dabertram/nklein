import { describe, expect, it } from "vitest";
import { type CapabilityBrokerInput, decideCapabilityAction } from "../../../src/core/capability-broker";
import type { ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

/**
 * §5.L capability broker — the context-aware decision core that composes the manifest-escalation pre-check, the
 * taint STYLE-only rule, and the egress rule into ONE verdict `allow | deny | one_time_confirm |
 * require_fresh_trusted_plan`. These tests build inputs from the REAL module shapes and pin the load-bearing
 * PRECEDENCE: a raw capability escalation denies before any taint/plan/egress context can rescue it.
 */

/** A read-only workspace tool: the least-privilege baseline every "read" tool is admitted with. */
const READ_BASELINE: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};

/** A manifest identical to a baseline — the common "stayed within its envelope" per-call request. */
function sameAs(manifest: ToolCapabilityManifest): ToolCapabilityManifest {
	return { ...manifest };
}

describe("decideCapabilityAction", () => {
	it("(centerpiece) DENIES a read tool requesting a host_write FIRST, even when taint+egress would each object differently", () => {
		// A read-only baseline whose per-call request smuggles in a host mutation (also host fsScope): the classic
		// injected-instruction escalation. Crucially the surrounding context is loaded so that BOTH softer gates would
		// fire a DIFFERENT verdict if they ran first: web-tainted content moving a protected `network` sink with NO plan
		// (→ require_fresh_trusted_plan) AND a confirm-tier egress (→ one_time_confirm). The ONLY way this returns `deny`
		// is if the raw-escalation gate is checked FIRST and short-circuits — so this pins the load-bearing ordering, not
		// merely "escalation is reached eventually". No taint/plan/egress context may rescue (or re-verdict) a raw
		// escalation.
		const requested: ToolCapabilityManifest = {
			mutationLevel: "host_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "auto",
			replayable: false,
		};
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested,
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: false,
			egress: {
				target: "https://api.example.com",
				networkPolicy: "full",
				requirePerActionApproval: true,
			},
		});

		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toBeDefined();
		expect(result.escalatedAxes).toContain("mutationLevel");
		// The host fsScope over-reach is escalated too — both axes are named for the audit trail.
		expect(result.escalatedAxes).toContain("fsScope");
	});

	it("PRECEDENCE: a manifest escalation denies even when the taint gate would demand a fresh trusted plan", () => {
		// The middle ordering the other precedence tests skip: escalation vs. the require-fresh-trusted-plan gate. Web-
		// tainted content moving a protected `network` sink with NO plan would (in isolation) return
		// require_fresh_trusted_plan; a host_write escalation is present too. Escalation is checked first, so this denies —
		// a taint-gate-first ordering would (wrongly) return require_fresh_trusted_plan and this assertion would catch it.
		const requested: ToolCapabilityManifest = {
			mutationLevel: "host_write",
			networkLevel: "none",
			fsScope: "host",
			approval: "auto",
			replayable: false,
		};
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested,
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: false,
		});

		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toContain("mutationLevel");
	});

	it("requires a FRESH TRUSTED PLAN when web-tainted content moves a protected network sink with no plan", () => {
		// Within-manifest request (no escalation), but web-tainted content is trying to change a protected `network`
		// capability with NO trusted plan → the broker demands re-grounding rather than allowing it.
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: false,
		});

		expect(result.decision).toBe("require_fresh_trusted_plan");
		// A require-fresh-plan verdict carries no escalatedAxes (it is not a manifest escalation).
		expect(result.escalatedAxes).toBeUndefined();
	});

	it("ALLOWS the same protected influence when it is backed by a trusted plan (non-deny path)", () => {
		// Identical to the previous case except a genuine trusted plan + confirmation backs the protected influence:
		// the ONE gate that lets tainted content reach a protected sink. No egress ⇒ straight to allow.
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: true,
		});

		expect(result.decision).toBe("allow");
	});

	it("returns ONE_TIME_CONFIRM for a confirm-tier egress on an otherwise-clean call", () => {
		// No escalation, benign style influence, but the egress policy requires a per-action approval for this
		// permitted public host → the broker surfaces a one-time confirm.
		const input: CapabilityBrokerInput = {
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: ["user_trusted"],
			influence: "style",
			egress: {
				target: "https://api.example.com/v1",
				networkPolicy: "full",
				requirePerActionApproval: true,
			},
		};
		const result = decideCapabilityAction(input);

		expect(result.decision).toBe("one_time_confirm");
	});

	it("ALLOWS a benign call: no escalation, no protected influence, no egress confirm", () => {
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: ["web"],
			// A `style`-class influence is always permitted even from tainted content — the whole point of admitting it.
			influence: "style",
		});

		expect(result.decision).toBe("allow");
		expect(result.escalatedAxes).toBeUndefined();
	});

	it("PRECEDENCE: a manifest escalation denies even when the egress would otherwise confirm", () => {
		// Both an escalation AND a confirm-tier egress are present; escalation wins (checked first, deny is hardest).
		const requested: ToolCapabilityManifest = {
			mutationLevel: "read",
			networkLevel: "egress",
			fsScope: "workspace",
			approval: "auto",
			replayable: true,
		};
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested,
			taintLabels: [],
			egress: {
				target: "https://api.example.com",
				networkPolicy: "full",
				requirePerActionApproval: true,
			},
		});

		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toContain("networkLevel");
	});

	it("PRECEDENCE: a trusted-plan requirement outranks an egress confirm", () => {
		// Tainted protected influence with no plan AND a confirm-tier egress: the require-fresh-plan gate is checked
		// before the softer egress confirm, so re-grounding is demanded first.
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: ["mcp"],
			influence: "host_access",
			backedByTrustedPlan: false,
			egress: {
				target: "https://api.example.com",
				networkPolicy: "full",
				requirePerActionApproval: true,
			},
		});

		expect(result.decision).toBe("require_fresh_trusted_plan");
	});

	it("fail-closes an egress DENY (inward-pivot host) into a whole-action deny", () => {
		// Egress to a LAN host is denied by the egress core; the broker denies the whole action (egress is fail-closed),
		// but with no escalatedAxes since it is not a manifest escalation.
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: [],
			egress: {
				target: "http://localhost:8080/admin",
				networkPolicy: "full",
			},
		});

		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toBeUndefined();
	});

	it("ALLOWS an egress call with no per-action approval (egress flows freely)", () => {
		const result = decideCapabilityAction({
			baseline: READ_BASELINE,
			requested: sameAs(READ_BASELINE),
			taintLabels: [],
			egress: {
				target: "https://api.example.com",
				networkPolicy: "full",
			},
		});

		expect(result.decision).toBe("allow");
	});

	it("DENIES an approval-gate skip (auto below a confirm baseline) as an escalation", () => {
		// A tool admitted behind a `confirm` gate whose per-call request asks to run as plain `auto` is trying to skip
		// the confirmation — the inverted approval axis makes this an escalation.
		const confirmBaseline: ToolCapabilityManifest = {
			mutationLevel: "sandbox_write",
			networkLevel: "none",
			fsScope: "workspace",
			approval: "confirm",
			replayable: false,
		};
		const requested: ToolCapabilityManifest = { ...confirmBaseline, approval: "auto" };
		const result = decideCapabilityAction({
			baseline: confirmBaseline,
			requested,
			taintLabels: [],
		});

		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toContain("approval");
	});
});
