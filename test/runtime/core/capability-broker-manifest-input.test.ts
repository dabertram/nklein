import { describe, expect, it } from "vitest";
import { decideCapabilityAction } from "../../../src/core/capability-broker";
import {
	type BrokerManifestArgs,
	brokerManifestAction,
	capabilityBrokerInputFromManifest,
} from "../../../src/core/capability-broker-manifest-input";
import { manifestForChatAction, type ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

/**
 * §5.AF capability-broker FROM-MANIFEST adapter — proves the ergonomic constructor is a FAITHFUL, policy-free projection
 * onto {@link decideCapabilityAction}'s input, so the broker's load-bearing precedence is reproduced EXACTLY through the
 * adapter. The centerpiece walks the four verdicts in precedence order — (a) raw escalation → deny, (b) tainted protected
 * influence w/o plan → require_fresh_trusted_plan, (c) same but plan-backed → allow, (d) benign in-manifest → allow —
 * building manifests via `manifestForChatAction` + hand-built literals matching the real type.
 */

/** The read baseline every read tool is admitted with (via the real chat-action manifest bridge). */
const READ_BASELINE: ToolCapabilityManifest = manifestForChatAction("sandbox_read");

describe("capabilityBrokerInputFromManifest", () => {
	it("is a 1:1 projection: every field maps through onto the broker input shape unchanged", () => {
		const args: BrokerManifestArgs = {
			baseline: READ_BASELINE,
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: ["web", "mcp"],
			influence: "network",
			backedByTrustedPlan: true,
			egress: { target: "https://api.example.com", networkPolicy: "full", requirePerActionApproval: true },
		};
		const input = capabilityBrokerInputFromManifest(args);
		expect(input.baseline).toBe(args.baseline);
		expect(input.requested).toBe(args.requested);
		expect(input.taintLabels).toEqual(["web", "mcp"]);
		expect(input.influence).toBe("network");
		expect(input.backedByTrustedPlan).toBe(true);
		expect(input.egress).toBe(args.egress);
	});

	it("passes the optional context fields through as undefined so the broker's own defaults apply", () => {
		const input = capabilityBrokerInputFromManifest({
			baseline: READ_BASELINE,
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: [],
		});
		// The adapter injects NO defaults of its own — an absent influence/plan/egress stays absent and the broker's
		// defaults (style / false / skip-egress) do the work. Assert they are literally undefined here.
		expect(input.influence).toBeUndefined();
		expect(input.backedByTrustedPlan).toBeUndefined();
		expect(input.egress).toBeUndefined();
	});
});

describe("brokerManifestAction (centerpiece: precedence reproduced through the adapter)", () => {
	it("(a) a read baseline requesting a host_write ESCALATES → deny with escalatedAxes", () => {
		// A read-only tool whose per-call request smuggles in a host mutation — the classic injected-instruction
		// escalation. No taint/plan/egress context may rescue a raw capability escalation; it denies outright, and the
		// over-reached axes are named for the audit trail. host_write is host-scoped, so BOTH mutationLevel + fsScope escalate.
		const result = brokerManifestAction({
			baseline: READ_BASELINE,
			requested: manifestForChatAction("host_write"),
			taintLabels: [],
		});
		expect(result.decision).toBe("deny");
		expect(result.escalatedAxes).toBeDefined();
		expect(result.escalatedAxes).toContain("mutationLevel");
		expect(result.escalatedAxes).toContain("fsScope");
	});

	it("(b) web-tainted content influencing a protected NETWORK sink WITHOUT a trusted plan → require_fresh_trusted_plan", () => {
		// Stays within manifest (a benign read), so the escalation gate passes — but web-tainted context tries to move the
		// protected `network` sink with NO plan, so the STYLE-only rule fires: the action must be re-grounded first.
		const result = brokerManifestAction({
			baseline: READ_BASELINE,
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: false,
		});
		expect(result.decision).toBe("require_fresh_trusted_plan");
	});

	it("(c) the SAME tainted protected influence but backedByTrustedPlan:true → allow (non-deny)", () => {
		// Identical to (b) except a trusted plan + confirmation now backs the protected influence — the ONE gate that lets
		// tainted content reach a protected sink. Nothing else objects, so the action is allowed.
		const result = brokerManifestAction({
			baseline: READ_BASELINE,
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: ["web"],
			influence: "network",
			backedByTrustedPlan: true,
		});
		expect(result.decision).toBe("allow");
		expect(result.decision).not.toBe("deny");
	});

	it("(d) a benign within-manifest read action → allow", () => {
		// No escalation, no taint, no egress — the trivial happy path all four gates pass.
		const result = brokerManifestAction({
			baseline: READ_BASELINE,
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: [],
		});
		expect(result.decision).toBe("allow");
	});
});

describe("brokerManifestAction ≡ decideCapabilityAction(capabilityBrokerInputFromManifest(args))", () => {
	it("is byte-identical to decideCapabilityAction on the constructed input across every verdict", () => {
		// The adapter adds NO policy: the convenience call must equal composing the constructor with the broker by hand,
		// for each of the four verdicts. This pins the equivalence the whole module rests on.
		const cases: BrokerManifestArgs[] = [
			// deny (escalation)
			{ baseline: READ_BASELINE, requested: manifestForChatAction("host_write"), taintLabels: [] },
			// require_fresh_trusted_plan (tainted protected influence, no plan)
			{
				baseline: READ_BASELINE,
				requested: manifestForChatAction("sandbox_read"),
				taintLabels: ["web"],
				influence: "network",
				backedByTrustedPlan: false,
			},
			// one_time_confirm (permitted public egress behind a per-action approval)
			{
				baseline: manifestForChatAction("sandbox_read"),
				requested: manifestForChatAction("sandbox_read"),
				taintLabels: [],
				egress: { target: "https://api.example.com", networkPolicy: "full", requirePerActionApproval: true },
			},
			// allow (benign)
			{ baseline: READ_BASELINE, requested: manifestForChatAction("sandbox_read"), taintLabels: [] },
		];
		for (const args of cases) {
			expect(brokerManifestAction(args)).toEqual(decideCapabilityAction(capabilityBrokerInputFromManifest(args)));
		}
	});

	it("surfaces the egress confirm tier as one_time_confirm through the adapter", () => {
		// A within-manifest read whose egress is a permitted public host gated behind a per-action approval → the broker's
		// one_time_confirm. Confirms the egress request rides through the adapter onto the right field.
		const result = brokerManifestAction({
			baseline: manifestForChatAction("sandbox_read"),
			requested: manifestForChatAction("sandbox_read"),
			taintLabels: [],
			egress: { target: "https://api.example.com", networkPolicy: "full", requirePerActionApproval: true },
		});
		expect(result.decision).toBe("one_time_confirm");
	});
});
