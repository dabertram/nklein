import { describe, expect, it } from "vitest";
import {
	expandSandboxEgressEcosystems,
	listSandboxEgressEcosystems,
	SANDBOX_EGRESS_ECOSYSTEM_PACKS,
} from "../../../src/core/sandbox-egress-ecosystems";
import {
	allowlistForRoleFromScoped,
	parseEgressAllowlist,
	parseRoleScopedEgressAllowlist,
} from "../../../src/nklein-agent/egress-proxy-role-snapshot";

/** P1.SANDBOXPACKS (b): `ecosystem:<name>` in the allowlist expands to that ecosystem's canonical registry hosts. */
describe("sandbox egress ecosystem packs", () => {
	it("expands a pack in place and leaves plain hosts byte-identical", () => {
		expect(expandSandboxEgressEcosystems(["registry.npmjs.org", "ecosystem:python", "api.example.com"])).toEqual([
			"registry.npmjs.org",
			"pypi.org",
			"files.pythonhosted.org",
			"api.example.com",
		]);
	});

	it("keeps an unknown pack as a plain (unreachable) entry — fail-safe-narrow", () => {
		expect(expandSandboxEgressEcosystems(["ecosystem:nope"])).toEqual(["ecosystem:nope"]);
	});

	it("expands role-scoped packs into role-scoped hosts", () => {
		expect(expandSandboxEgressEcosystems(["worker:ecosystem:rust"])).toEqual(
			SANDBOX_EGRESS_ECOSYSTEM_PACKS.rust?.map((host) => `worker:${host}`),
		);
	});

	it("is wired into the canonical parser, so the proxy sees hosts, never pack names", () => {
		expect(parseEgressAllowlist("ecosystem:npm, ecosystem:python\nregistry.npmjs.org")).toEqual([
			"registry.npmjs.org",
			"pypi.org",
			"files.pythonhosted.org",
		]);
		const scoped = parseRoleScopedEgressAllowlist("ecosystem:npm, worker:ecosystem:python");
		expect(scoped.global).toEqual(["registry.npmjs.org"]);
		expect(allowlistForRoleFromScoped(scoped)("worker")).toEqual([
			"registry.npmjs.org",
			"pypi.org",
			"files.pythonhosted.org",
		]);
		expect(allowlistForRoleFromScoped(scoped)("reviewer")).toEqual(["registry.npmjs.org"]);
	});

	it("every pack names only registry hosts, no wildcards, no schemes", () => {
		for (const [name, hosts] of Object.entries(SANDBOX_EGRESS_ECOSYSTEM_PACKS)) {
			expect(hosts.length, name).toBeGreaterThan(0);
			for (const host of hosts) expect(host).toMatch(/^[a-z0-9.-]+$/u);
		}
		expect(listSandboxEgressEcosystems()).toContain("python");
	});
});
