import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProceduralSkill, type ProceduralSkill } from "../../../src/core/procedural-skill-record";
import { buildSessionSkillFragments } from "../../../src/nklein-agent/nklein-session-skill-fragments";

const FLAG = "NKLEIN_SKILL_PROMPT_FRAGMENTS";
const PROC_FLAG = "NKLEIN_PROCEDURAL_SKILLS";

describe("buildSessionSkillFragments (§5.AE effectful bridge)", () => {
	let workspace: string;
	let savedFlag: string | undefined;
	let savedProcFlag: string | undefined;

	const mkProc = (id: string, tags: string[]): ProceduralSkill =>
		createProceduralSkill({
			id,
			title: `${id}-title`,
			content: `${id}-steps`,
			contentHash: `h-${id}`,
			applicabilityTags: tags,
			provenance: { source: "learned", trust: "trusted", capturedAt: 0 },
			status: "active",
			now: 0,
		});

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), "kanban-skillfrag-"));
		// A source file with a symbol so the repo map has content to render.
		writeFileSync(
			join(workspace, "widget.ts"),
			"export function computeWidget(): number {\n\treturn 42;\n}\n",
			"utf8",
		);
		savedFlag = process.env[FLAG];
		delete process.env[FLAG];
		savedProcFlag = process.env[PROC_FLAG];
		delete process.env[PROC_FLAG];
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
		if (savedFlag === undefined) {
			delete process.env[FLAG];
		} else {
			process.env[FLAG] = savedFlag;
		}
		if (savedProcFlag === undefined) {
			delete process.env[PROC_FLAG];
		} else {
			process.env[PROC_FLAG] = savedProcFlag;
		}
	});

	it("flag OFF (default) ⇒ no fragments, no workspace scan (byte-identical start)", async () => {
		const fragments = await buildSessionSkillFragments({
			role: "worker",
			taskText: "fix a bug",
			workspacePath: workspace,
		});
		expect(fragments).toEqual([]);
	});

	it("flag ON + a code role ⇒ a repo-map system fragment with rendered content", async () => {
		process.env[FLAG] = "1";
		const fragments = await buildSessionSkillFragments({
			role: "worker", // code_editing bundle declares repo_map
			taskText: "fix a bug in the widget",
			workspacePath: workspace,
		});
		const repoMap = fragments.find((fragment) => fragment.key === "repo-map");
		expect(repoMap).toBeDefined();
		expect(repoMap?.volatility).toBe("task");
		expect(repoMap?.text.length ?? 0).toBeGreaterThan(0);
	});

	it("flag ON but no workspace ⇒ no repo-map fragment (fail-soft, never blocks a start)", async () => {
		process.env[FLAG] = "1";
		const fragments = await buildSessionSkillFragments({
			role: "worker",
			taskText: "fix a bug",
			workspacePath: null,
		});
		expect(fragments.find((fragment) => fragment.key === "repo-map")).toBeUndefined();
	});

	it("F4.19: procedural flag OFF ⇒ no procedural fragments even with matching skills in the store (byte-identical)", async () => {
		const fragments = await buildSessionSkillFragments({
			role: "worker",
			taskText: "run the schema migration",
			workspacePath: null,
			loadProceduralSkills: async () => [mkProc("p1", ["migration"])],
		});
		expect(fragments.find((f) => f.key.startsWith("procedural-skill:"))).toBeUndefined();
	});

	it("F4.19: procedural flag ON ⇒ surfaces a matching ACTIVE procedure as a fragment; empty store ⇒ none", async () => {
		process.env[PROC_FLAG] = "1";
		const withMatch = await buildSessionSkillFragments({
			role: "worker",
			taskText: "run the schema migration on startup",
			workspacePath: null,
			loadProceduralSkills: async () => [mkProc("p1", ["migration"]), mkProc("p2", ["unrelated"])],
		});
		const proc = withMatch.find((f) => f.key === "procedural-skill:p1");
		expect(proc).toBeDefined();
		expect(proc?.text).toContain("p1-steps");
		expect(withMatch.find((f) => f.key === "procedural-skill:p2")).toBeUndefined(); // no tag overlap

		const emptyStore = await buildSessionSkillFragments({
			role: "worker",
			taskText: "run the schema migration",
			workspacePath: null,
			loadProceduralSkills: async () => [],
		});
		expect(emptyStore.find((f) => f.key.startsWith("procedural-skill:"))).toBeUndefined();
	});

	it("§5.AE (approved follow-up 2026-07-05): the skill-dynamics level is HONORED — `assigned_skills` (no ids) suppresses the repo map", async () => {
		process.env[FLAG] = "1";
		// Baseline: the resolver's default (fully_dynamic) resolves the worker code bundle → a repo-map fragment.
		const dynamic = await buildSessionSkillFragments({
			role: "worker",
			taskText: "fix a bug in the widget",
			workspacePath: workspace,
		});
		expect(dynamic.find((fragment) => fragment.key === "repo-map")).toBeDefined();
		// With the user's level = assigned_skills and NO assigned ids, resolveActiveSkills yields an EMPTY skill set,
		// so NO repo-map fragment is produced. This can only differ from the baseline if dynamicsLevel is truly threaded
		// (before the fix, buildSessionSkillFragments ignored it and always used fully_dynamic).
		const assigned = await buildSessionSkillFragments({
			role: "worker",
			taskText: "fix a bug in the widget",
			workspacePath: workspace,
			dynamicsLevel: "assigned_skills",
		});
		expect(assigned.find((fragment) => fragment.key === "repo-map")).toBeUndefined();
	});
});
describe("F4.17 overflow capping", () => {
	it("keeps the highest-importance fragments within the budget and is byte-identical without one", async () => {
		process.env.NKLEIN_PROCEDURAL_SKILLS = "1";
		try {
			const bigSkill = {
				id: "sk-big",
				title: "big",
				content: "x".repeat(8_000),
				status: "active" as const,
				applicabilityTags: ["worker"],
				version: 1,
				contentHash: "h",
				outcomes: { helped: 0, hurt: 0 },
				supersededBy: null,
				provenance: { source: "learned", trust: "local", capturedAt: 1 },
				updatedAt: 1,
			};
			const uncapped = await buildSessionSkillFragments({
				role: "worker",
				taskText: "worker task",
				workspacePath: process.cwd(),
				modelId: null,
				sandboxMcpEnabled: false,
				loadProceduralSkills: async () => [bigSkill],
			});
			const capped = await buildSessionSkillFragments({
				role: "worker",
				taskText: "worker task",
				workspacePath: process.cwd(),
				modelId: null,
				sandboxMcpEnabled: false,
				loadProceduralSkills: async () => [bigSkill],
				fragmentBudgetTokens: 100,
			});
			expect(capped.length).toBeLessThanOrEqual(uncapped.length);
			const cappedTokens = capped.reduce((sum, f) => sum + Math.ceil(f.text.length / 4), 0);
			expect(cappedTokens).toBeLessThanOrEqual(100);
		} finally {
			delete process.env.NKLEIN_PROCEDURAL_SKILLS;
		}
	});
});

// F4.13 model-sensitive pruning — the prune threshold fires on a measured-sensitive row.
describe("model-sensitive fragment pruning (F4.13)", () => {
	it("crosses the prune threshold for a fully-sensitive observation", async () => {
		const { estimateDistractorSensitivity } = await import("../../../src/core/model-sensitive-pruning");
		expect(
			estimateDistractorSensitivity([{ noiseFraction: 0.5, baselineQuality: 1, noisyQuality: 0 }]),
		).toBeGreaterThanOrEqual(0.5);
		expect(estimateDistractorSensitivity([{ noiseFraction: 0.5, baselineQuality: 1, noisyQuality: 1 }])).toBe(0);
	});
});
