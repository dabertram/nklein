import { describe, expect, it } from "vitest";
import {
	allAlwaysKeepToolNames,
	alwaysKeepToolsForRole,
	assertTerminalToolPresent,
} from "../../src/core/role-always-keep-tools";
import { SWARM_ROLES } from "../../src/core/role-model-class";

describe("alwaysKeepToolsForRole", () => {
	it("gives every role a terminal tool — without one the turn cannot END", () => {
		// The deadlock case: a reviewer with no submit_review cannot submit a review. That is not a degraded turn,
		// it is a hung card.
		for (const role of SWARM_ROLES) {
			expect(alwaysKeepToolsForRole(role).length).toBeGreaterThan(2);
		}
	});

	it("gives the reviewer submit_review specifically", () => {
		expect(alwaysKeepToolsForRole("reviewer")).toContain("submit_review");
	});

	it("does NOT give the reviewer the worker's terminal tools", () => {
		// Keeping the union everywhere would inflate every role's floor, and the gate exists because 40+ offered
		// tools cause 62% of tool-use failures. Every kept tool is a tool not gated.
		expect(alwaysKeepToolsForRole("reviewer")).not.toContain("attempt_completion");
		expect(alwaysKeepToolsForRole("worker")).not.toContain("submit_review");
	});

	it("gives every role a read tool", () => {
		// A turn that cannot read cannot begin, and the failure presents as a stall rather than a wrong answer —
		// the harder kind to diagnose.
		for (const role of SWARM_ROLES) {
			expect(alwaysKeepToolsForRole(role).some((name) => name.startsWith("read_"))).toBe(true);
		}
	});

	it("stays SMALL — an alwaysKeep set that grows reinstates the problem it guards against", () => {
		// The gate targets ~7 offered tools. A floor approaching that defeats the gate while looking like safety.
		for (const role of SWARM_ROLES) {
			expect(alwaysKeepToolsForRole(role).length).toBeLessThanOrEqual(4);
		}
	});
});

describe("assertTerminalToolPresent", () => {
	it("passes when the catalog offers the role's terminal tool", () => {
		const result = assertTerminalToolPresent("reviewer", ["read_file", "submit_review", "bash"]);
		expect(result.present).toBe(true);
	});

	it("FAILS when no terminal tool is offered — alwaysKeep cannot protect what is absent", () => {
		// This is a harness misconfiguration, not a gating decision. Gating would proceed innocently and the
		// resulting deadlock would be blamed on the gate.
		const result = assertTerminalToolPresent("reviewer", ["read_file", "bash", "write_file"]);
		expect(result.present).toBe(false);
		expect(result.reason).toContain("HARNESS misconfiguration");
		expect(result.reason).toContain("blamed on the gate");
	});

	it("is case-insensitive about tool names", () => {
		expect(assertTerminalToolPresent("reviewer", ["SUBMIT_REVIEW"]).present).toBe(true);
	});

	it("reports the catalog size, so a near-empty catalog is visible in the message", () => {
		expect(assertTerminalToolPresent("worker", []).reason).toContain("catalog of 0");
	});
});

describe("allAlwaysKeepToolNames", () => {
	it("is the deduplicated union across roles", () => {
		const all = allAlwaysKeepToolNames();
		expect(new Set(all).size).toBe(all.length);
		expect(all).toContain("submit_review");
		expect(all).toContain("read_file");
	});
});
