import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import {
	getDefaultNKleinDevTestScenario,
	NKLEIN_DEV_TEST_PROJECT_MARKER_PATH,
	resolveNKleinDevTestProjectScenario,
	resolveNKleinDevTestTemplatePath,
	scaffoldNKleinDevTestProject,
} from "../../../src/nklein-agent/nklein-dev-test-project";

const execFileAsync = promisify(execFile);

async function createParentDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-dev-test-project-"));
}

describe("nklein dev test project", () => {
	it("resolves the bundled smoke fixture template", async () => {
		const templatePath = resolveNKleinDevTestTemplatePath();
		await expect(readFile(join(templatePath, "package.json"), "utf8")).resolves.toContain("kanban-smoke-ts-cli");
	});

	it("scaffolds a throwaway workspace with a user-facing specification", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
		});

		expect(project.workspacePath.startsWith(parentDir)).toBe(true);
		expect(project.gitInitialized).toBe(false);
		expect(project.scenario).toEqual(getDefaultNKleinDevTestScenario());
		await expect(readFile(join(project.workspacePath, "src", "habit-score.ts"), "utf8")).resolves.toContain(
			"calculateHabitScore",
		);
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain(getDefaultNKleinDevTestScenario().title);
		expect(specification).toContain("## Fixture/toolchain rules");
		expect(specification).toContain("test/**/*.test.ts");
		expect(specification).toContain(".test.js");
		// The offline rule is UNIVERSAL — every agent sandbox is offline. Live 20260810-211914: the ts-starter
		// scaffold carried no toolchain rules at all, so the worker chose vitest and burned 111 failed
		// npm install/npm test commands against a wall that can never yield.
		expect(specification).toContain("OFFLINE");
		expect(specification).not.toContain("Acceptance command");
		const marker = JSON.parse(
			await readFile(join(project.workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH), "utf8"),
		) as {
			createdBy?: string;
			scenarioId?: string;
		};
		expect(marker).toEqual(
			expect.objectContaining({
				createdBy: "nklein-dev-test",
				scenarioId: getDefaultNKleinDevTestScenario().id,
			}),
		);
		await expect(access(join(project.workspacePath, "kanban-dev-scenario.json"))).rejects.toThrow();
	});

	it("runs TypeScript test files in the smoke fixture", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: false,
		});

		await writeFile(
			join(project.workspacePath, "test", "typescript-syntax.test.ts"),
			[
				'import test from "node:test";',
				'import assert from "node:assert/strict";',
				'import { calculateHabitScore, type HabitScoreInput } from "../src/habit-score.ts";',
				"",
				'test("accepts TypeScript syntax in .test.ts files", () => {',
				"\tconst input: HabitScoreInput = { completedDays: 1, targetDays: 1, streakDays: 0 };",
				"\tassert.equal(calculateHabitScore(input), 100);",
				"});",
				"",
			].join("\n"),
			"utf8",
		);

		await execFileAsync("npm", ["test"], { cwd: project.workspacePath, timeout: 30_000 });
	});

	it("honors a configured workspaceBaseDir (the §5.W global setting) when no explicit parentDir is given", async () => {
		// `workspaceBaseDir` is the value the runtime threads from the global `workspaceBaseDir` setting; with no
		// explicit parentDir, the safe-location resolver creates the workspace under that configured base.
		const workspaceBaseDir = await createParentDir();
		const project = await scaffoldNKleinDevTestProject({
			workspaceBaseDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
		});
		expect(project.workspacePath.startsWith(workspaceBaseDir)).toBe(true);
	});

	it("initializes git with !Klein ownership metadata", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: true,
		});

		// Scrubbed env (§4A): these assertion spawns must not resolve a hook-inherited GIT_DIR.
		const { stdout } = await execFileAsync("git", ["config", "--get", "kanban.repositoryCreatedByKanban"], {
			cwd: project.workspacePath,
			env: createGitProcessEnv(),
		});
		expect(stdout.trim()).toBe("true");
		const head = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
			cwd: project.workspacePath,
			env: createGitProcessEnv(),
		});
		expect(head.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
	});

	// §5.BF 2026-07-11: an inherited GIT_INDEX_FILE/GIT_DIR (e.g. the scaffold invoked from inside a git hook) must
	// NOT hijack the fixture's git init/add/commit into the outer repo's index. createGitProcessEnv scrubs them.
	it("scaffolds successfully even when a polluting GIT_INDEX_FILE/GIT_DIR is present in the environment", async () => {
		const parentDir = await createParentDir();
		const bogusIndex = join(await createParentDir(), "hijack.index");
		const bogusGitDir = join(await createParentDir(), "outer.git");
		const saved = { index: process.env.GIT_INDEX_FILE, dir: process.env.GIT_DIR };
		process.env.GIT_INDEX_FILE = bogusIndex;
		process.env.GIT_DIR = bogusGitDir;
		try {
			const project = await scaffoldNKleinDevTestProject({ parentDir, initializeGit: true });
			// The commit landed in the fixture's OWN repo (not the outer GIT_DIR), and no hijack index was written.
			// Verify with a scrubbed env so THIS assertion's git call doesn't inherit the bogus GIT_DIR either.
			const cleanEnv = { ...process.env };
			delete cleanEnv.GIT_INDEX_FILE;
			delete cleanEnv.GIT_DIR;
			const head = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
				cwd: project.workspacePath,
				env: cleanEnv,
			});
			expect(head.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
			await expect(access(bogusIndex)).rejects.toThrow();
		} finally {
			if (saved.index === undefined) delete process.env.GIT_INDEX_FILE;
			else process.env.GIT_INDEX_FILE = saved.index;
			if (saved.dir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = saved.dir;
		}
	});

	it("scaffolds the audio VST fixture for the audio preset", async () => {
		const parentDir = await createParentDir();
		const scenario = resolveNKleinDevTestProjectScenario("audio_vst");
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			scenario,
			initializeGit: false,
		});

		expect(project.scenario).toEqual(resolveNKleinDevTestProjectScenario("audio_vst"));
		await expect(readFile(join(project.workspacePath, "src", "plugin.ts"), "utf8")).resolves.toContain("renderKick");
		const packageJson = await readFile(join(project.workspacePath, "package.json"), "utf8");
		expect(packageJson).toContain("nklein-audio-vst-synth-fixture");
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain("phase-aligned kick/bass pattern");
	});

	it("scaffolds the DAW foundation fixture for the DAW preset", async () => {
		const parentDir = await createParentDir();
		const scenario = resolveNKleinDevTestProjectScenario("daw_foundation");
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			scenario,
			initializeGit: false,
		});

		expect(project.scenario).toEqual(resolveNKleinDevTestProjectScenario("daw_foundation"));
		await expect(readFile(join(project.workspacePath, "src", "timebase.ts"), "utf8")).resolves.toContain("TempoMap");
		const packageJson = await readFile(join(project.workspacePath, "package.json"), "utf8");
		expect(packageJson).toContain("nklein-daw-foundation-fixture");
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain("Modern Cross-Platform DAW Foundation Release Specification");
		expect(specification).toContain("VST3-compatible plugin hosting");
	});

	it("keeps the audio VST seed prompt focused on user-level project intent", () => {
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).toContain(
			"at least ten dependent implementation cards",
		);
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).toContain("knowledge assumptions explicit");
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).toContain("Acceptance command: npm test");
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).not.toContain("decompose_project");
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).not.toContain("read_files");
		expect(resolveNKleinDevTestProjectScenario("audio_vst").prompt).not.toContain(".nklein/nklein");
	});

	it("keeps the DAW foundation seed prompt focused on user-level project intent", () => {
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).toContain("deeply decomposed");
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).toContain("knowledge debt explicitly");
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).toContain("Acceptance command: npm test");
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).not.toContain("decompose_project");
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).not.toContain("read_files");
		expect(resolveNKleinDevTestProjectScenario("daw_foundation").prompt).not.toContain(".nklein/nklein");
	});

	it("resolves the parallel-fan-out presets to distinct scenarios (§5.O)", () => {
		expect(resolveNKleinDevTestProjectScenario("wide_fanout").id).toBe("habit-wide-fanout");
		expect(resolveNKleinDevTestProjectScenario("deep_chain").id).toBe("habit-deep-chain");
		expect(resolveNKleinDevTestProjectScenario("mixed_dag").id).toBe("habit-mixed-dag");
		expect(resolveNKleinDevTestProjectScenario("many_small").id).toBe("habit-many-small");
		const ids = [
			resolveNKleinDevTestProjectScenario("wide_fanout"),
			resolveNKleinDevTestProjectScenario("deep_chain"),
			resolveNKleinDevTestProjectScenario("mixed_dag"),
			resolveNKleinDevTestProjectScenario("many_small"),
		].map((scenario) => scenario.id);
		expect(new Set(ids).size).toBe(4);
	});

	it("fan-out seed prompts steer the intended DAG shape and stay user-level (§5.O)", () => {
		expect(resolveNKleinDevTestProjectScenario("wide_fanout").prompt).toContain("INDEPENDENT");
		expect(resolveNKleinDevTestProjectScenario("wide_fanout").prompt.toLowerCase()).toContain("parallel");
		expect(resolveNKleinDevTestProjectScenario("deep_chain").prompt.toLowerCase()).toContain("linear");
		expect(resolveNKleinDevTestProjectScenario("deep_chain").prompt).toContain(
			"depends on the immediately preceding card",
		);
		expect(resolveNKleinDevTestProjectScenario("mixed_dag").prompt.toLowerCase()).toContain("join");
		expect(resolveNKleinDevTestProjectScenario("many_small").prompt).toContain("at least twenty");
		for (const scenario of [
			resolveNKleinDevTestProjectScenario("wide_fanout"),
			resolveNKleinDevTestProjectScenario("deep_chain"),
			resolveNKleinDevTestProjectScenario("mixed_dag"),
			resolveNKleinDevTestProjectScenario("many_small"),
		]) {
			expect(scenario.prompt).toContain("Acceptance command: npm test");
			expect(scenario.prompt).not.toContain("decompose_project");
			expect(scenario.prompt).not.toContain("read_files");
			expect(scenario.prompt).not.toContain(".nklein/nklein");
			expect(scenario.acceptanceCommand).toBe("npm test");
		}
	});

	it("scaffolds a fan-out preset on the smoke CLI template (§5.O)", async () => {
		const parentDir = await createParentDir();
		const scenario = resolveNKleinDevTestProjectScenario("wide_fanout");
		const project = await scaffoldNKleinDevTestProject({ parentDir, scenario, initializeGit: false });

		expect(project.scenario).toEqual(resolveNKleinDevTestProjectScenario("wide_fanout"));
		await expect(readFile(join(project.workspacePath, "src", "habit-score.ts"), "utf8")).resolves.toContain(
			"calculateHabitScore",
		);
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain(resolveNKleinDevTestProjectScenario("wide_fanout").title);
	});
	it("a CUSTOM scenario scaffolds ITS specification, not the default preset's (live-found 2026-08-20)", async () => {
		// The CLI resolved the scaffold from `preset` while seeding the card from `--scenario-file`, so a custom
		// run got the custom PROMPT and the DEFAULT preset's workspace + specification.md. A self-contained
		// prompt never notices; the 36/36 master challenge says "read all of specification.md" and was graded
		// on a 2.4 KB habit-insights spec instead of its own 192 KB one.
		const parentDir = await createParentDir();
		const custom = {
			id: "custom-scenario",
			title: "Custom Scenario Title",
			prompt: "Read all of specification.md before planning.",
			specification: "# Custom specification\n\nThis text proves the scaffold used the CUSTOM scenario.",
			acceptanceCommand: "npm test",
		};
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
			scenario: custom as never,
		});
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain("This text proves the scaffold used the CUSTOM scenario.");
		expect(specification).toContain("Custom Scenario Title");
		// …and crucially NOT the default scenario's, which is what the agent was actually reading.
		expect(specification).not.toContain(getDefaultNKleinDevTestScenario().title);
	});
	it("ships a section index beside a LARGE spec, and points the agent at it (live-found 2026-08-20)", async () => {
		// On the 36/36 master challenge a 27B agent read the 24,000-word spec faithfully — windowed reads,
		// zero tool errors — and died of quadratic prefill at 67k context before its first decompose call.
		// Linear reading is the wrong tool for a large spec, and the agent had no other.
		const parentDir = await createParentDir();
		const sections = Array.from(
			{ length: 12 },
			(_, i) => `## Section ${i}\n\n${"requirement detail words ".repeat(150)}`,
		).join("\n\n");
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
			scenario: {
				id: "big-spec",
				title: "Big Spec Challenge",
				prompt: "Read all of specification.md before planning.",
				specification: sections,
				acceptanceCommand: "npm test",
			} as never,
		});
		const index = await readFile(join(project.workspacePath, "specification.index.md"), "utf8");
		expect(index).toContain("Do NOT read it end-to-end");
		// Line ranges are what makes the index ACTIONABLE for the agent's own read_files tool.
		expect(index).toMatch(/\| \d+-\d+ \| \d+ \| ## Section 0 \|/);
		const spec = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(spec).toContain("Large specification");
		expect(spec).toContain("specification.index.md");

		// …and a SMALL spec stays exactly as before: no index, no pointer.
		const small = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
			scenario: {
				id: "small-spec",
				title: "Small Spec",
				prompt: "do it",
				specification: "One short requirement.",
				acceptanceCommand: "npm test",
			} as never,
		});
		await expect(readFile(join(small.workspacePath, "specification.index.md"), "utf8")).rejects.toThrow();
		const smallSpec = await readFile(join(small.workspacePath, "specification.md"), "utf8");
		expect(smallSpec).not.toContain("Large specification");
	});
});
