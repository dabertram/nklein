import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO,
	DEFAULT_NKLEIN_DEV_TEST_SCENARIO,
	NKLEIN_DEV_TEST_PROJECT_MARKER_PATH,
	resolveNKleinDevTestProjectScenario,
	resolveNKleinDevTestTemplatePath,
	scaffoldNKleinDevTestProject,
} from "../../../src/nklein-sdk/nklein-dev-test-project";

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
		expect(project.scenario).toEqual(DEFAULT_NKLEIN_DEV_TEST_SCENARIO);
		await expect(readFile(join(project.workspacePath, "src", "habit-score.ts"), "utf8")).resolves.toContain(
			"calculateHabitScore",
		);
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain(DEFAULT_NKLEIN_DEV_TEST_SCENARIO.title);
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
				scenarioId: DEFAULT_NKLEIN_DEV_TEST_SCENARIO.id,
			}),
		);
		await expect(access(join(project.workspacePath, "kanban-dev-scenario.json"))).rejects.toThrow();
	});

	it("initializes git with !Klein ownership metadata", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			initializeGit: true,
		});

		const { stdout } = await execFileAsync("git", ["config", "--get", "kanban.repositoryCreatedByKanban"], {
			cwd: project.workspacePath,
		});
		expect(stdout.trim()).toBe("true");
		const head = await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
			cwd: project.workspacePath,
		});
		expect(head.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
	});

	it("scaffolds the audio VST fixture for the audio preset", async () => {
		const parentDir = await createParentDir();
		const scenario = resolveNKleinDevTestProjectScenario("audio_vst");
		const project = await scaffoldNKleinDevTestProject({
			parentDir,
			scenario,
			initializeGit: false,
		});

		expect(project.scenario).toEqual(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO);
		await expect(readFile(join(project.workspacePath, "src", "plugin.ts"), "utf8")).resolves.toContain("renderKick");
		const packageJson = await readFile(join(project.workspacePath, "package.json"), "utf8");
		expect(packageJson).toContain("nklein-audio-vst-synth-fixture");
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain("phase-aligned kick/bass pattern");
	});

	it("keeps the audio VST seed prompt focused on user-level project intent", () => {
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).toContain("at least ten dependent implementation cards");
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).toContain("knowledge assumptions explicit");
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).toContain("Acceptance command: npm test");
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).not.toContain("decompose_project");
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).not.toContain("read_files");
		expect(AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO.prompt).not.toContain(".nklein/nklein");
	});
});
