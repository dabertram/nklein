import { execFile } from "node:child_process";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TEMPLATE_NAME = "smoke-ts-cli";

export interface ClineDevTestProjectScenario {
	id: string;
	title: string;
	prompt: string;
	acceptanceCommand: string;
}

export interface ScaffoldClineDevTestProjectOptions {
	scenario?: ClineDevTestProjectScenario;
	parentDir?: string;
	templateName?: string;
	initializeGit?: boolean;
	now?: () => number;
}

export interface ScaffoldedClineDevTestProject {
	workspacePath: string;
	templatePath: string;
	scenario: ClineDevTestProjectScenario;
	acceptanceCommand: string;
	gitInitialized: boolean;
}

export const DEFAULT_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "small-model-smoke",
	title: "Small model smoke task",
	prompt:
		"Update the habit score logic so perfect completion is capped at 100 even with a long streak, and add or update the acceptance test.",
	acceptanceCommand: "npm test",
};

function getRepoRootFromCurrentModule(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function slugify(input: string): string {
	const slug = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "dev-test";
}

export function resolveClineDevTestTemplatePath(templateName = DEFAULT_TEMPLATE_NAME): string {
	return join(getRepoRootFromCurrentModule(), "scripts", "dev-fixtures", templateName);
}

async function initializeGitRepository(workspacePath: string): Promise<void> {
	await execFileAsync("git", ["init"], { cwd: workspacePath });
	await execFileAsync("git", ["config", "kanban.repositoryCreatedByKanban", "true"], { cwd: workspacePath });
	await execFileAsync("git", ["add", "."], { cwd: workspacePath });
	await execFileAsync("git", ["commit", "-m", "Initial dev test fixture"], {
		cwd: workspacePath,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Kanban Dev Test",
			GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "kanban-dev-test@example.invalid",
			GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Kanban Dev Test",
			GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "kanban-dev-test@example.invalid",
		},
	});
}

export async function scaffoldClineDevTestProject(
	options: ScaffoldClineDevTestProjectOptions = {},
): Promise<ScaffoldedClineDevTestProject> {
	const scenario = options.scenario ?? DEFAULT_CLINE_DEV_TEST_SCENARIO;
	const parentDir = options.parentDir ?? tmpdir();
	const now = options.now ?? Date.now;
	const workspacePath = await mkdtemp(join(parentDir, `kanban-${slugify(scenario.id)}-${now()}-`));
	const templatePath = resolveClineDevTestTemplatePath(options.templateName);
	await cp(templatePath, workspacePath, {
		recursive: true,
		errorOnExist: false,
		force: true,
	});
	await writeFile(
		join(workspacePath, "kanban-dev-scenario.json"),
		`${JSON.stringify(
			{
				id: scenario.id,
				title: scenario.title,
				prompt: scenario.prompt,
				acceptanceCommand: scenario.acceptanceCommand,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	const shouldInitializeGit = options.initializeGit ?? true;
	if (shouldInitializeGit) {
		await initializeGitRepository(workspacePath);
	}
	return {
		workspacePath,
		templatePath,
		scenario,
		acceptanceCommand: scenario.acceptanceCommand,
		gitInitialized: shouldInitializeGit,
	};
}
