import { describe, expect, it } from "vitest";
import { decideCapabilityBrokerGate } from "../../../src/core/capability-broker-gate";
import type { ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

const READ: ToolCapabilityManifest = {
	mutationLevel: "read",
	networkLevel: "none",
	fsScope: "workspace",
	approval: "auto",
	replayable: true,
};
const HOST_WRITE: ToolCapabilityManifest = {
	mutationLevel: "host_write",
	networkLevel: "none",
	fsScope: "host",
	approval: "confirm",
	replayable: false,
};

describe("decideCapabilityBrokerGate", () => {
	it("allows a no-protected-sink action regardless of taint", () => {
		expect(decideCapabilityBrokerGate({ manifest: READ, taintLabels: ["web"] })).toEqual({
			allow: true,
			reason: null,
		});
	});

	it("allows a protected-sink action when NO untrusted taint is present", () => {
		expect(decideCapabilityBrokerGate({ manifest: HOST_WRITE, taintLabels: [] }).allow).toBe(true);
		expect(decideCapabilityBrokerGate({ manifest: HOST_WRITE, taintLabels: ["user_trusted"] }).allow).toBe(true);
	});

	it("DENIES a protected sink after untrusted web content entered the turn (no trusted plan)", () => {
		const verdict = decideCapabilityBrokerGate({ manifest: HOST_WRITE, taintLabels: ["web"] });
		expect(verdict.allow).toBe(false);
		expect(verdict.reason).toBeTruthy();
	});

	it("a trusted plan relaxes the taint-influence rule", () => {
		expect(
			decideCapabilityBrokerGate({ manifest: HOST_WRITE, taintLabels: ["web"], backedByTrustedPlan: true }).allow,
		).toBe(true);
	});

	it("a read-only egress (egress_read) is not a protected sink → never blocked by taint", () => {
		const egressRead: ToolCapabilityManifest = { ...READ, networkLevel: "egress_read" };
		expect(decideCapabilityBrokerGate({ manifest: egressRead, taintLabels: ["web"] }).allow).toBe(true);
	});
});
