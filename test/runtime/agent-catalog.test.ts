import { describe, expect, it } from "vitest";
import { RUNTIME_AGENT_CATALOG, usesLegacyHostTaskWorkspace } from "../../src/core/agent-catalog";

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
