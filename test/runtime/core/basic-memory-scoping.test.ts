import { describe, expect, it } from "vitest";
import {
	BASIC_MEMORY_GLOBAL_PROJECT,
	basicMemoryHardeningEnv,
	basicMemoryProjectName,
	basicMemorySeedProjectArgs,
	planBasicMemorySandboxWiring,
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

describe("planBasicMemorySandboxWiring", () => {
	it("emits RW mounts for the config dir + every project's notes dir, plus the exec env", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "w1", scopes: ["global"] });
		const wiring = planBasicMemorySandboxWiring(plan);
		// config dir first, then per-project + global notes — all read-write.
		expect(wiring.mounts.every((m) => m.readWrite)).toBe(true);
		expect(wiring.mounts[0]).toEqual({
			hostPath: "/h/basic-memory/w1/config",
			containerPath: plan.containerConfigDir,
			readWrite: true,
		});
		const notesMounts = wiring.mounts.slice(1);
		expect(notesMounts.map((m) => m.hostPath)).toEqual(["/h/basic-memory/w1/notes", "/h/basic-memory/global/notes"]);
		expect(wiring.env).toBe(plan.env);
	});

	it("project-only ⇒ config + one notes mount", () => {
		const wiring = planBasicMemorySandboxWiring(
			planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "w2", scopes: [] }),
		);
		expect(wiring.mounts).toHaveLength(2); // config + per-project notes
	});
});

describe("basicMemorySeedProjectArgs", () => {
	it("emits a `project add <name> <notesDir>` per project (validated live: no auto-init)", () => {
		const plan = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "w1", scopes: ["global"] });
		const seeds = basicMemorySeedProjectArgs(plan);
		expect(seeds).toEqual([
			["basic-memory", "project", "add", "ws-w1", "/nklein/basic-memory/w1/notes"],
			["basic-memory", "project", "add", "global", "/nklein/basic-memory/global"],
		]);
	});
});

describe("planBasicMemoryScoping — multi-project collision safety (shared container)", () => {
	// Regression for the 2026-07-05 multi-project outage: the shared sandbox container mounts EVERY registered
	// project's stores at once, so per-project container destinations MUST carry the workspace hash (else two projects
	// collide on the same `--mount` dst and `docker run` fails). The global store is the one deliberately-shared dst.
	it("per-project container paths are UNIQUE per workspace; the global path is the ONLY shared one", () => {
		const a = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "aaa", scopes: ["global"] });
		const b = planBasicMemoryScoping({ runtimeHome: "/h", workspaceHash: "bbb", scopes: ["global"] });
		// config dirs differ across workspaces (no collision):
		expect(a.containerConfigDir).toBe("/nklein/basic-memory/aaa/config");
		expect(b.containerConfigDir).toBe("/nklein/basic-memory/bbb/config");
		expect(a.containerConfigDir).not.toBe(b.containerConfigDir);
		// per-project notes dirs differ across workspaces:
		const aProject = a.projects.find((p) => p.scope === "project");
		const bProject = b.projects.find((p) => p.scope === "project");
		expect(aProject?.containerNotesDir).toBe("/nklein/basic-memory/aaa/notes");
		expect(bProject?.containerNotesDir).toBe("/nklein/basic-memory/bbb/notes");
		expect(aProject?.containerNotesDir).not.toBe(bProject?.containerNotesDir);
		// the GLOBAL notes dir is intentionally identical (shared cross-repo store — runtime dedups the mount):
		const aGlobal = a.projects.find((p) => p.scope === "global");
		const bGlobal = b.projects.find((p) => p.scope === "global");
		expect(aGlobal?.containerNotesDir).toBe("/nklein/basic-memory/global");
		expect(aGlobal?.containerNotesDir).toBe(bGlobal?.containerNotesDir);
	});
});
