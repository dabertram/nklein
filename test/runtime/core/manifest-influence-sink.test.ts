import { describe, expect, it } from "vitest";
import { manifestProtectedInfluenceKinds } from "../../../src/core/manifest-influence-sink";
import { isProtectedInfluence, type ProtectedInfluenceKind } from "../../../src/core/taint-labels";
import type { ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

/**
 * §5.AF × §5.L manifest → protected-influence-sink adapter. These tests build inputs from the REAL manifest shape and
 * pin the projection: which §5.L protected sink(s) a manifested action's blast radius touches. The centerpiece is a
 * characterization of the exact axis→sink mapping plus the standing invariant that EVERY returned kind is a genuine
 * {@link isProtectedInfluence} member; the adversarial case proves a multi-axis manifest returns both sinks, deduped.
 */

/** A plain workspace read — the least-privilege manifest that touches NO protected sink. */
const SANDBOX_READ: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};

describe("manifestProtectedInfluenceKinds", () => {
	it("(centerpiece) maps egress→network, host_write→host_access, plain read→[], and every returned kind is isProtectedInfluence", () => {
		// An egress-only manifest lands on the network sink.
		const egress: ToolCapabilityManifest = { ...SANDBOX_READ, networkLevel: "egress" };
		expect(manifestProtectedInfluenceKinds(egress)).toEqual<ProtectedInfluenceKind[]>(["network"]);

		// A host_write manifest (host mutation + host fs) lands on the host-access sink.
		const hostWrite: ToolCapabilityManifest = {
			mutationLevel: "host_write",
			networkLevel: "none",
			fsScope: "host",
			approval: "confirm",
			replayable: false,
		};
		expect(manifestProtectedInfluenceKinds(hostWrite)).toEqual<ProtectedInfluenceKind[]>(["host_access"]);

		// A plain sandbox read touches no protected sink at all.
		expect(manifestProtectedInfluenceKinds(SANDBOX_READ)).toEqual<ProtectedInfluenceKind[]>([]);

		// The standing invariant across all three: every kind returned is genuinely a protected influence.
		for (const manifest of [egress, hostWrite, SANDBOX_READ]) {
			for (const kind of manifestProtectedInfluenceKinds(manifest)) {
				expect(isProtectedInfluence(kind)).toBe(true);
			}
		}
	});

	it("host READ (fsScope host, no host_write) still lands on the host-access sink via the fsScope axis alone", () => {
		const hostRead: ToolCapabilityManifest = {
			mutationLevel: "read",
			networkLevel: "none",
			fsScope: "host",
			approval: "confirm",
			replayable: true,
		};
		expect(manifestProtectedInfluenceKinds(hostRead)).toEqual<ProtectedInfluenceKind[]>(["host_access"]);
	});

	it("maps the elevated approval tiers (typed_host, risk_ack) to the approvals sink", () => {
		const typedHost: ToolCapabilityManifest = { ...SANDBOX_READ, approval: "typed_host" };
		expect(manifestProtectedInfluenceKinds(typedHost)).toEqual<ProtectedInfluenceKind[]>(["approvals"]);

		const riskAck: ToolCapabilityManifest = { ...SANDBOX_READ, approval: "risk_ack" };
		expect(manifestProtectedInfluenceKinds(riskAck)).toEqual<ProtectedInfluenceKind[]>(["approvals"]);
	});

	it("does NOT treat the plain approval tiers (auto, confirm) as an approvals-sink influence", () => {
		expect(manifestProtectedInfluenceKinds({ ...SANDBOX_READ, approval: "auto" })).toEqual<ProtectedInfluenceKind[]>(
			[],
		);
		expect(manifestProtectedInfluenceKinds({ ...SANDBOX_READ, approval: "confirm" })).toEqual<
			ProtectedInfluenceKind[]
		>([]);
	});

	it("(adversarial) a manifest touching TWO axes returns BOTH kinds, deduped — an egress host_write", () => {
		// Both the network axis (egress) AND the host axes (host_write + host fsScope) fire. host_write and fsScope:host
		// are TWO conditions for the SAME host-access sink, so the result must still contain host_access exactly ONCE.
		const egressHostWrite: ToolCapabilityManifest = {
			mutationLevel: "host_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "confirm",
			replayable: false,
		};
		const kinds = manifestProtectedInfluenceKinds(egressHostWrite);

		expect(kinds).toContain<ProtectedInfluenceKind>("network");
		expect(kinds).toContain<ProtectedInfluenceKind>("host_access");
		expect(kinds).toHaveLength(2);
		// Deduped: host_access appears exactly once despite two host axes matching.
		expect(kinds.filter((k) => k === "host_access")).toHaveLength(1);
	});

	it("(adversarial) a manifest tripping ALL THREE conditions returns three deduped, all-protected kinds", () => {
		const everything: ToolCapabilityManifest = {
			mutationLevel: "host_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "typed_host",
			replayable: false,
		};
		const kinds = manifestProtectedInfluenceKinds(everything);

		expect(new Set(kinds)).toEqual(new Set<ProtectedInfluenceKind>(["network", "host_access", "approvals"]));
		expect(kinds).toHaveLength(3);
		for (const kind of kinds) {
			expect(isProtectedInfluence(kind)).toBe(true);
		}
	});
});
