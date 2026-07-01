import { describe, expect, it } from "vitest";
import {
	type CapabilityAxis,
	capabilityAxisLabel,
	detectCapabilityEscalation,
	isCapabilityEscalation,
} from "../../../src/core/capability-escalation";
import { manifestForChatAction, type ToolCapabilityManifest } from "../../../src/core/tool-capability-manifest";

/** A baseline manifest builder — sensible mid-tier defaults, overridable per axis. */
function manifest(overrides: Partial<ToolCapabilityManifest> = {}): ToolCapabilityManifest {
	return {
		mutationLevel: "sandbox_write",
		networkLevel: "none",
		fsScope: "workspace",
		approval: "confirm",
		replayable: false,
		...overrides,
	};
}

const ALL_AXES: CapabilityAxis[] = ["mutationLevel", "networkLevel", "fsScope", "approval"];

describe("capability-escalation — identical / no-op", () => {
	it("allows a request identical to its baseline with empty deltas", () => {
		const base = manifest();
		const result = detectCapabilityEscalation(base, { ...base });
		expect(result.decision).toBe("allow");
		expect(result.escalations).toEqual([]);
		expect(result.deEscalations).toEqual([]);
		expect(result.reason).toContain("matches the tool's granted manifest exactly");
		expect(isCapabilityEscalation(base, { ...base })).toBe(false);
	});

	it("ignores `replayable` — it is not a capability axis, so it never triggers a delta", () => {
		const base = manifest({ replayable: true });
		const result = detectCapabilityEscalation(base, manifest({ replayable: false }));
		expect(result.decision).toBe("allow");
		expect(result.escalations).toEqual([]);
		expect(result.deEscalations).toEqual([]);
	});
});

describe("capability-escalation — single-axis ESCALATION (deny)", () => {
	it("denies a mutation-level escalation (read → host_write) and names the axis", () => {
		const base = manifest({ mutationLevel: "read" });
		const result = detectCapabilityEscalation(base, manifest({ mutationLevel: "host_write" }));
		expect(result.decision).toBe("deny");
		expect(result.escalations).toHaveLength(1);
		expect(result.escalations[0]).toMatchObject({
			axis: "mutationLevel",
			direction: "escalated",
			baseline: "read",
			requested: "host_write",
		});
		expect(result.escalations[0].detail).toContain("exceeds the granted");
		expect(result.reason).toContain("mutationLevel");
		expect(isCapabilityEscalation(base, manifest({ mutationLevel: "host_write" }))).toBe(true);
	});

	it("denies a mutation-level escalation by a single rung (sandbox_write → control_plane)", () => {
		const result = detectCapabilityEscalation(
			manifest({ mutationLevel: "sandbox_write" }),
			manifest({ mutationLevel: "control_plane" }),
		);
		expect(result.decision).toBe("deny");
		expect(result.escalations[0].axis).toBe("mutationLevel");
	});

	it("denies a network escalation (none → egress)", () => {
		const result = detectCapabilityEscalation(
			manifest({ networkLevel: "none" }),
			manifest({ networkLevel: "egress" }),
		);
		expect(result.decision).toBe("deny");
		expect(result.escalations[0]).toMatchObject({ axis: "networkLevel", baseline: "none", requested: "egress" });
	});

	it("denies a filesystem-scope escalation (workspace → host)", () => {
		const result = detectCapabilityEscalation(manifest({ fsScope: "workspace" }), manifest({ fsScope: "host" }));
		expect(result.decision).toBe("deny");
		expect(result.escalations[0]).toMatchObject({ axis: "fsScope", baseline: "workspace", requested: "host" });
	});

	it("denies an approval DOWNGRADE (typed_host → auto) — trying to skip the gate is an escalation", () => {
		const result = detectCapabilityEscalation(manifest({ approval: "typed_host" }), manifest({ approval: "auto" }));
		expect(result.decision).toBe("deny");
		expect(result.escalations[0]).toMatchObject({ axis: "approval", baseline: "typed_host", requested: "auto" });
	});

	it("denies an approval downgrade by one tier (risk_ack → confirm)", () => {
		const result = detectCapabilityEscalation(manifest({ approval: "risk_ack" }), manifest({ approval: "confirm" }));
		expect(result.decision).toBe("deny");
		expect(result.escalations[0].axis).toBe("approval");
	});
});

describe("capability-escalation — single-axis DE-ESCALATION (allow)", () => {
	it("allows using less mutation power (host_write baseline → read request)", () => {
		const result = detectCapabilityEscalation(
			manifest({ mutationLevel: "host_write" }),
			manifest({ mutationLevel: "read" }),
		);
		expect(result.decision).toBe("allow");
		expect(result.escalations).toEqual([]);
		expect(result.deEscalations).toHaveLength(1);
		expect(result.deEscalations[0]).toMatchObject({
			axis: "mutationLevel",
			direction: "de_escalated",
			baseline: "host_write",
			requested: "read",
		});
		expect(result.reason).toContain("tightened");
	});

	it("allows dropping network reach (egress baseline → none request)", () => {
		const result = detectCapabilityEscalation(
			manifest({ networkLevel: "egress" }),
			manifest({ networkLevel: "none" }),
		);
		expect(result.decision).toBe("allow");
		expect(result.deEscalations[0].axis).toBe("networkLevel");
	});

	it("allows requesting a STRICTER approval tier (auto baseline → typed_host request)", () => {
		const result = detectCapabilityEscalation(manifest({ approval: "auto" }), manifest({ approval: "typed_host" }));
		expect(result.decision).toBe("allow");
		expect(result.deEscalations[0]).toMatchObject({ axis: "approval", direction: "de_escalated" });
	});
});

describe("capability-escalation — multi-axis / mixed", () => {
	it("reports EVERY escalated axis when several are exceeded at once", () => {
		const base = manifest({
			mutationLevel: "read",
			networkLevel: "none",
			fsScope: "workspace",
			approval: "auto",
		});
		const req = manifest({
			mutationLevel: "host_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "auto",
		});
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("deny");
		expect(result.escalations.map((delta) => delta.axis)).toEqual(["mutationLevel", "networkLevel", "fsScope"]);
		expect(result.reason).toContain("3 axis(es)");
	});

	it("DENIES when ANY axis escalates even if another de-escalates (a violation cannot be netted out)", () => {
		// Tightens the approval (auto→confirm de-escalation) but broadens the mutation level (read→host_write escalation).
		const base = manifest({ mutationLevel: "read", approval: "confirm" });
		const req = manifest({ mutationLevel: "host_write", approval: "typed_host" });
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("deny");
		expect(result.escalations.map((d) => d.axis)).toEqual(["mutationLevel"]);
		// The de-escalation is still recorded for the audit, not silently discarded.
		expect(result.deEscalations.map((d) => d.axis)).toEqual(["approval"]);
	});

	it("preserves the CAPABILITY_AXES reporting order (mutation → network → fs → approval) in escalations", () => {
		// Escalate every axis at once; escalations must come out in canonical axis order. The power axes go UP, but the
		// approval axis escalates by going DOWN (baseline `confirm` gate → requested `auto` skips it).
		const base = manifest({
			mutationLevel: "read",
			networkLevel: "none",
			fsScope: "workspace",
			approval: "confirm",
		});
		const req = manifest({
			mutationLevel: "sandbox_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "auto",
		});
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("deny");
		expect(result.escalations.map((d) => d.axis)).toEqual(["mutationLevel", "networkLevel", "fsScope", "approval"]);
	});
});

describe("capability-escalation — realistic manifests (composed from manifestForChatAction)", () => {
	it("denies a sandbox_read tool trying to act like a host_write tool", () => {
		const base = manifestForChatAction("sandbox_read"); // read / none / workspace / auto
		const req = manifestForChatAction("host_write"); // host_write / none / host / confirm
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("deny");
		// mutationLevel (read→host_write) and fsScope (workspace→host) both escalate; approval auto→confirm is MORE
		// friction, so it counts as a de-escalation (a request may never LOWER its required gate, only raise it).
		expect(result.escalations.map((d) => d.axis)).toEqual(["mutationLevel", "fsScope"]);
		expect(result.deEscalations.map((d) => d.axis)).toEqual(["approval"]);
	});

	it("DENIES a host_write tool making a sandbox_read request — it would LOWER the confirmation floor", () => {
		// A subtle-but-correct consequence: mutation + fs tighten, but `sandbox_read`'s `auto` approval is BELOW
		// `host_write`'s `confirm` floor, so the request would skip the gate the tool was admitted behind → escalation.
		const base = manifestForChatAction("host_write"); // host_write / none / host / confirm
		const req = manifestForChatAction("sandbox_read"); // read / none / workspace / auto
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("deny");
		expect(result.escalations.map((d) => d.axis)).toEqual(["approval"]);
		expect(result.deEscalations.map((d) => d.axis)).toEqual(["mutationLevel", "fsScope"]);
	});

	it("allows a fully-within-envelope request that tightens some axes and holds the approval floor", () => {
		// Baseline grants host_write / egress / host / auto. The request drops mutation+network+fs but KEEPS auto (does
		// not lower the gate), so every differing axis is a de-escalation and nothing escalates.
		const base = manifest({
			mutationLevel: "host_write",
			networkLevel: "egress",
			fsScope: "host",
			approval: "auto",
		});
		const req = manifest({
			mutationLevel: "read",
			networkLevel: "none",
			fsScope: "workspace",
			approval: "auto",
		});
		const result = detectCapabilityEscalation(base, req);
		expect(result.decision).toBe("allow");
		expect(result.escalations).toEqual([]);
		expect(result.deEscalations.map((d) => d.axis)).toEqual(["mutationLevel", "networkLevel", "fsScope"]);
	});

	it("allows a chat action requesting its own manifest (self-consistent, no escalation)", () => {
		for (const action of ["sandbox_read", "sandbox_write", "control_plane", "host_read", "host_write"] as const) {
			const m = manifestForChatAction(action);
			expect(detectCapabilityEscalation(m, { ...m }).decision).toBe("allow");
		}
	});
});

describe("capability-escalation — axis labels + parity", () => {
	it("capabilityAxisLabel returns a human label for every axis", () => {
		expect(capabilityAxisLabel("mutationLevel")).toBe("mutation blast-radius");
		expect(capabilityAxisLabel("networkLevel")).toBe("network reach");
		expect(capabilityAxisLabel("fsScope")).toBe("filesystem scope");
		expect(capabilityAxisLabel("approval")).toBe("approval tier");
	});

	it("every CapabilityAxis produces a delta when that axis (and only it) is escalated — the axis set is fully wired", () => {
		// A baseline from which every axis can escalate by exactly one rung. The power axes are at their FLOOR (escalate
		// UP); the approval axis is at its CEILING `typed_host` (escalates DOWN by dropping the required gate).
		const base = manifest({
			mutationLevel: "read",
			networkLevel: "none",
			fsScope: "workspace",
			approval: "typed_host",
		});
		const oneRungEscalation: Record<CapabilityAxis, Partial<ToolCapabilityManifest>> = {
			mutationLevel: { mutationLevel: "sandbox_write" },
			networkLevel: { networkLevel: "egress" },
			fsScope: { fsScope: "host" },
			approval: { approval: "risk_ack" }, // typed_host → risk_ack: lowers the gate by one rung (an escalation)
		};
		for (const axis of ALL_AXES) {
			const result = detectCapabilityEscalation(base, manifest({ ...base, ...oneRungEscalation[axis] }));
			expect(result.decision, `axis ${axis} should escalate`).toBe("deny");
			expect(result.escalations.map((d) => d.axis)).toEqual([axis]);
		}
	});
});
