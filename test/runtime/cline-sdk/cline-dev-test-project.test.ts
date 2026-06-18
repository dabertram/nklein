import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	CLINE_DEV_TEST_PROJECT_MARKER_PATH,
	DEFAULT_CLINE_DEV_TEST_SCENARIO,
	resolveClineDevTestTemplatePath,
	scaffoldClineDevTestProject,
} from "../../../src/cline-sdk/cline-dev-test-project";

const execFileAsync = promisify(execFile);

async function createParentDir(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-dev-test-project-"));
}

describe("cline dev test project", () => {
	it("resolves the bundled smoke fixture template", async () => {
		const templatePath = resolveClineDevTestTemplatePath();
		await expect(readFile(join(templatePath, "package.json"), "utf8")).resolves.toContain("kanban-smoke-ts-cli");
	});

	it("scaffolds a throwaway workspace with a user-facing specification", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldClineDevTestProject({
			parentDir,
			initializeGit: false,
			now: () => 1_700_000_000_000,
		});

		expect(project.workspacePath.startsWith(parentDir)).toBe(true);
		expect(project.gitInitialized).toBe(false);
		expect(project.scenario).toEqual(DEFAULT_CLINE_DEV_TEST_SCENARIO);
		await expect(readFile(join(project.workspacePath, "src", "habit-score.ts"), "utf8")).resolves.toContain(
			"calculateHabitScore",
		);
		const specification = await readFile(join(project.workspacePath, "specification.md"), "utf8");
		expect(specification).toContain(DEFAULT_CLINE_DEV_TEST_SCENARIO.title);
		expect(specification).not.toContain("Acceptance command");
		const marker = JSON.parse(
			await readFile(join(project.workspacePath, CLINE_DEV_TEST_PROJECT_MARKER_PATH), "utf8"),
		) as {
			createdBy?: string;
			scenarioId?: string;
		};
		expect(marker).toEqual(
			expect.objectContaining({
				createdBy: "nklein-dev-test",
				scenarioId: DEFAULT_CLINE_DEV_TEST_SCENARIO.id,
			}),
		);
		await expect(access(join(project.workspacePath, "kanban-dev-scenario.json"))).rejects.toThrow();
	});

	it("initializes git with !Klein ownership metadata", async () => {
		const parentDir = await createParentDir();
		const project = await scaffoldClineDevTestProject({
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
});
