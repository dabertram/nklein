import { describe, expect, it } from "vitest";
import {
	BASIC_MEMORY_GLOBAL_PROJECT,
	basicMemoryHardeningEnv,
	basicMemoryProjectName,
	planBasicMemoryScoping,
} from "../../../src/core/basic-memory-scoping";

describe("basicMemoryHardeningEnv", () => {
	it("disables all three verified default-on egress vectors", () => {
		const env = basicMemoryHardeningEnv();
		expect(env.BASIC_MEMORY_AUTO_UPDATE).toBe("false"); // pypi auto-update thread
		expect(env.BASIC_MEMORY_NO_PROMOS).toBe("1"); // Umami analytics + cloud promos
		expect(env.HF_HUB_OFFLINE).toBe("1"); // FastEmbed first-use HF download
		expect(env.TRANSFORMERS_OFFLINE).toBe("1");
	});
});

describe("basicMemoryProjectName", () => {
	it("derives a stable per-workspace project name from the hash (never a host path)", () => {
		expect(basicMemoryProjectName("abc123")).toBe("ws-abc123");
		expect(basicMemoryProjectName("abc123")).not.toContain("/");
	});
});

describe("planBasicMemoryScoping", () => {
	it("project-only: one per-workspace store, pinned as default, with hardening + scoping env", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/home/u/.nklein", workspaceHash: "deadbeef", scopes: [] });
		expect(plan.projects.map((p) => p.scope)).toEqual(["project"]);
		expect(plan.defaultProject).toBe("ws-deadbeef");
		expect(plan.projects[0]?.hostNotesDir).toBe("/home/u/.nklein/basic-memory/deadbeef/notes");
		expect(plan.hostConfigDir).toBe("/home/u/.nklein/basic-memory/deadbeef/config");
		expect(plan.env.BASIC_MEMORY_CONFIG_DIR).toBe(plan.containerConfigDir);
		expect(plan.env.BASIC_MEMORY_MCP_PROJECT).toBe("ws-deadbeef");
		expect(plan.env.BASIC_MEMORY_AUTO_UPDATE).toBe("false"); // hardening folded in
	});

	it("project+global: registers BOTH stores; the per-project remains the pinned default", () => {
		const plan = planBasicMemoryScoping({
			runtimeHome: "/home/u/.nklein",
			workspaceHash: "cafe",
			scopes: ["global"],
		});
		expect(plan.projects.map((p) => p.scope)).toEqual(["project", "global"]);
		const global = plan.projects.find((p) => p.scope === "global");
		expect(global?.name).toBe(BASIC_MEMORY_GLOBAL_PROJECT);
		// Global notes live in a SHARED host dir (not per-workspace) so cross-repo lessons accrue in one place.
		expect(global?.hostNotesDir).toBe("/home/u/.nklein/basic-memory/global/notes");
		// The default pin is still the repo-scoped project — global is opt-in per tool call.
		expect(plan.defaultProject).toBe("ws-cafe");
	});

	it("always includes the per-project store even if scopes omit it", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "x", scopes: ["global"] });
		expect(plan.projects.some((p) => p.scope === "project")).toBe(true);
	});

	it("trims a trailing slash on runtimeHome (no doubled separators)", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/home/u/.nklein/", workspaceHash: "z", scopes: [] });
		expect(plan.hostConfigDir).toBe("/home/u/.nklein/basic-memory/z/config");
	});

	it("dedups scopes (global passed twice ⇒ one global registration)", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "y", scopes: ["global", "global"] });
		expect(plan.projects.filter((p) => p.scope === "global")).toHaveLength(1);
	});
});
