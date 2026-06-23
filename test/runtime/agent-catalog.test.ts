import { describe, expect, it } from "vitest";
import {
	getRuntimeLaunchSupportedAgentCatalog,
	isRuntimeAgentLaunchSupported,
	RUNTIME_AGENT_CATALOG,
	RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS,
	usesLegacyHostTaskWorkspace,
} from "../../src/core/agent-catalog";

describe("usesLegacyHostTaskWorkspace (host-worktree boundary)", () => {
	it("never uses a host worktree for the default NKlein / sandbox agent", () => {
		// The NKlein agent runs in the Docker sandbox and captures a result branch — no host worktree.
		// This is the retirement invariant: a reachable (local-only) task start must not create a worktree.
		expect(usesLegacyHostTaskWorkspace("nklein")).toBe(false);
	});

	it("treats unset / null agent ids as the default (no host worktree)", () => {
		// Tasks created without an explicit agent default to the NKlein/sandbox path.
		expect(usesLegacyHostTaskWorkspace(null)).toBe(false);
		expect(usesLegacyHostTaskWorkspace(undefined)).toBe(false);
	});

	it("only explicit non-NKlein terminal/CLI agents use the legacy host worktree", () => {
		const legacyAgentIds = RUNTIME_AGENT_CATALOG.map((entry) => entry.id).filter((id) => id !== "nklein");
		expect(legacyAgentIds.length).toBeGreaterThan(0);
		for (const agentId of legacyAgentIds) {
			expect(usesLegacyHostTaskWorkspace(agentId)).toBe(true);
		}
	});
});

describe("nklein-only launch support (todo §5.A invariant)", () => {
	it("launches only the native NKlein agent", () => {
		expect([...RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS]).toEqual(["nklein"]);
		expect(isRuntimeAgentLaunchSupported("nklein")).toBe(true);
		expect(getRuntimeLaunchSupportedAgentCatalog().map((entry) => entry.id)).toEqual(["nklein"]);
	});

	it("does not launch any terminal/CLI agent", () => {
		for (const entry of RUNTIME_AGENT_CATALOG) {
			if (entry.id === "nklein") {
				continue;
			}
			expect(isRuntimeAgentLaunchSupported(entry.id)).toBe(false);
		}
	});

	it("no launchable agent ever creates a host worktree", () => {
		// Combined §5.A invariant: every launch-supported agent is the sandbox NKlein agent, which never
		// creates a host worktree — so no reachable task start can produce one (locks increments 1b + 2a/2b
		// ahead of the increment-3 worktree-subsystem deletion).
		for (const agentId of RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS) {
			expect(usesLegacyHostTaskWorkspace(agentId)).toBe(false);
		}
	});
});
