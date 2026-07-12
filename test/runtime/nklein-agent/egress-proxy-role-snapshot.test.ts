import { describe, expect, it } from "vitest";
import type { AgentCapabilityTier, SandboxNetworkPolicy } from "../../../src/core/agent-rulesets";
import {
	parseEgressAllowlist,
	resolveEgressProxyRoleSnapshot,
} from "../../../src/nklein-agent/egress-proxy-role-snapshot";

/**
 * Pure-resolver coverage for the I2b per-role snapshot source (docs/dev/egress-proxy-design.md §4 / §6 I1). Confirms
 * the tier→networkPolicy composition, the injected allowlist / approval seams, and fail-closed null for unknown roles.
 */

describe("resolveEgressProxyRoleSnapshot", () => {
	it("maps each capability tier to its network policy (composed from the rulesets)", () => {
		const cases: Array<[AgentCapabilityTier, SandboxNetworkPolicy]> = [
			["strict", "none"],
			["less_strict", "none"],
			["medium", "allowlist"],
			["more_open", "full"],
			["fully_open", "full"],
		];
		for (const [tier, networkPolicy] of cases) {
			const snapshot = resolveEgressProxyRoleSnapshot("worker", { capabilityConfig: { globalPreset: tier } });
			expect(snapshot).not.toBeNull();
			expect(snapshot?.role).toBe("worker");
			expect(snapshot?.networkPolicy).toBe(networkPolicy);
		}
	});

	it("defaults to an empty allowlist when no source is injected", () => {
		const snapshot = resolveEgressProxyRoleSnapshot("architect", { capabilityConfig: { globalPreset: "medium" } });
		expect(snapshot?.allowlist).toEqual([]);
	});

	it("flows an injected per-role allowlist through unchanged", () => {
		const snapshot = resolveEgressProxyRoleSnapshot("worker", {
			capabilityConfig: { globalPreset: "medium" },
			allowlistForRole: (role) => (role === "worker" ? ["api.example.com", "pkg.example.org"] : []),
		});
		expect(snapshot?.allowlist).toEqual(["api.example.com", "pkg.example.org"]);
	});

	it("honors a per-role capability override when resolving the tier", () => {
		const snapshot = resolveEgressProxyRoleSnapshot("reviewer", {
			capabilityConfig: { globalPreset: "fully_open", roleOverrides: { reviewer: "strict" } },
		});
		expect(snapshot?.networkPolicy).toBe("none");
	});

	it("includes requirePerActionApproval only when the injected source provides it", () => {
		const withApproval = resolveEgressProxyRoleSnapshot("worker", {
			capabilityConfig: { globalPreset: "medium" },
			requirePerActionApprovalForRole: () => true,
		});
		expect(withApproval?.requirePerActionApproval).toBe(true);

		const withoutApproval = resolveEgressProxyRoleSnapshot("worker", {
			capabilityConfig: { globalPreset: "medium" },
		});
		expect(withoutApproval).not.toBeNull();
		expect(withoutApproval?.requirePerActionApproval).toBeUndefined();
		// Omitted, not just undefined — matches the I2a snapshot shape (makeSnapshot in egress-proxy-server.test.ts).
		expect(withoutApproval ? Object.keys(withoutApproval) : []).not.toContain("requirePerActionApproval");
	});

	it("returns null for an unknown / unresolvable role (fail closed → server denies)", () => {
		expect(resolveEgressProxyRoleSnapshot("orchestrator")).toBeNull();
		expect(resolveEgressProxyRoleSnapshot("")).toBeNull();
	});

	it("resolves a known role with no config to the default tier's policy", () => {
		// DEFAULT_AGENT_CAPABILITY_TIER is fully_open → full network; deps omitted entirely.
		const snapshot = resolveEgressProxyRoleSnapshot("worker");
		expect(snapshot?.networkPolicy).toBe("full");
		expect(snapshot?.allowlist).toEqual([]);
	});

	it("binds a parsed global allowlist onto the snapshot (§6 I3 v1 single-global source)", () => {
		// The manager feeds `parseEgressAllowlist(config)` as ONE global source for every role.
		const allowlist = parseEgressAllowlist("api.example.com,\npkg.example.org, api.example.com");
		const worker = resolveEgressProxyRoleSnapshot("worker", {
			capabilityConfig: { globalPreset: "medium" },
			allowlistForRole: () => allowlist,
		});
		const architect = resolveEgressProxyRoleSnapshot("architect", {
			capabilityConfig: { globalPreset: "medium" },
			allowlistForRole: () => allowlist,
		});
		expect(worker?.allowlist).toEqual(["api.example.com", "pkg.example.org"]);
		// v1: the SAME global list is bound to every role.
		expect(architect?.allowlist).toEqual(["api.example.com", "pkg.example.org"]);
	});
});

describe("parseEgressAllowlist (§6 I3 config parser)", () => {
	it("returns [] for null / undefined / blank / separator-only input", () => {
		expect(parseEgressAllowlist(undefined)).toEqual([]);
		expect(parseEgressAllowlist(null)).toEqual([]);
		expect(parseEgressAllowlist("")).toEqual([]);
		expect(parseEgressAllowlist("   ")).toEqual([]);
		expect(parseEgressAllowlist("  ,\n , \n")).toEqual([]);
	});

	it("splits on commas AND newlines, trimming surrounding whitespace (incl. CR)", () => {
		expect(parseEgressAllowlist("api.example.com, pkg.example.org")).toEqual(["api.example.com", "pkg.example.org"]);
		expect(parseEgressAllowlist("api.example.com\npkg.example.org")).toEqual(["api.example.com", "pkg.example.org"]);
		expect(parseEgressAllowlist("  a.com  ,\n  b.com \r\n c.com ")).toEqual(["a.com", "b.com", "c.com"]);
	});

	it("drops blank entries and de-duplicates (first occurrence wins, order preserved)", () => {
		expect(parseEgressAllowlist("a.com,,a.com,\nb.com, a.com \n c.com")).toEqual(["a.com", "b.com", "c.com"]);
	});
});
