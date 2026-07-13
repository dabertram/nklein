import { describe, expect, it } from "vitest";
import {
	getRuntimeAgentCatalogEntry,
	getRuntimeLaunchSupportedAgentCatalog,
	isRuntimeAgentLaunchSupported,
	RUNTIME_AGENT_CATALOG,
	RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS,
} from "../../src/core/agent-catalog";
import { runtimeAgentIdSchema } from "../../src/core/api-contract";

describe("nklein-only agent catalog (P0.9c, legacy §2.B shrink)", () => {
	it("contains exactly the native NKlein agent", () => {
		expect(RUNTIME_AGENT_CATALOG.map((entry) => entry.id)).toEqual(["nklein"]);
		expect(getRuntimeAgentCatalogEntry("nklein")?.label).toBe("!Klein");
	});

	it("launches only the native NKlein agent", () => {
		expect([...RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS]).toEqual(["nklein"]);
		expect(isRuntimeAgentLaunchSupported("nklein")).toBe(true);
		expect(getRuntimeLaunchSupportedAgentCatalog().map((entry) => entry.id)).toEqual(["nklein"]);
	});
});

describe("runtimeAgentIdSchema legacy migration (P0.9c upgrade path)", () => {
	it("accepts the native agent id", () => {
		expect(runtimeAgentIdSchema.parse("nklein")).toBe("nklein");
	});

	it("migrates persisted pre-lockdown terminal-CLI agent ids to nklein instead of failing the load", () => {
		for (const legacyId of ["claude", "codex", "gemini", "opencode", "droid", "kiro"]) {
			expect(runtimeAgentIdSchema.parse(legacyId)).toBe("nklein");
		}
	});

	it("clamps arbitrary unknown values (a corrupt field must not fail a board/session load)", () => {
		expect(runtimeAgentIdSchema.parse("not-an-agent")).toBe("nklein");
		expect(runtimeAgentIdSchema.parse(42)).toBe("nklein");
	});
});
