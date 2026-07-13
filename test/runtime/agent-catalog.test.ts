import { describe, expect, it } from "vitest";
import {
	getRuntimeAgentCatalogEntry,
	getRuntimeLaunchSupportedAgentCatalog,
	isRuntimeAgentLaunchSupported,
	RUNTIME_AGENT_CATALOG,
	RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS,
} from "../../src/core/agent-catalog";
import { runtimeAgentIdSchema, runtimeAgentIdWithLegacyMigrationSchema } from "../../src/core/api-contract";

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

describe("runtimeAgentIdSchema (P0.9c: strict API surface + legacy-migration variant)", () => {
	it("accepts the native agent id and rejects everything else on the strict API surface", () => {
		expect(runtimeAgentIdSchema.parse("nklein")).toBe("nklein");
		expect(runtimeAgentIdSchema.safeParse("codex").success).toBe(false);
		expect(runtimeAgentIdSchema.safeParse("not-an-agent").success).toBe(false);
	});

	it("migrates persisted pre-lockdown terminal-CLI agent ids to nklein instead of failing the load", () => {
		for (const legacyId of ["claude", "codex", "gemini", "opencode", "droid", "kiro"]) {
			expect(runtimeAgentIdWithLegacyMigrationSchema.parse(legacyId)).toBe("nklein");
		}
	});

	it("clamps arbitrary unknown values (a corrupt field must not fail a board/session load)", () => {
		expect(runtimeAgentIdWithLegacyMigrationSchema.parse("not-an-agent")).toBe("nklein");
		expect(runtimeAgentIdWithLegacyMigrationSchema.parse(42)).toBe("nklein");
	});
});
