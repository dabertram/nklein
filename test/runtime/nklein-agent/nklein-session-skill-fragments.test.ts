import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSessionSkillFragments } from "../../../src/nklein-agent/nklein-session-skill-fragments";

const FLAG = "NKLEIN_SKILL_PROMPT_FRAGMENTS";

describe("buildSessionSkillFragments (§5.AE effectful bridge)", () => {
	let workspace: string;
	let savedFlag: string | undefined;

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
	});

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true });
		if (savedFlag === undefined) {
			delete process.env[FLAG];
		} else {
			process.env[FLAG] = savedFlag;
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
