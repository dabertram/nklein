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
	specification: string;
	acceptanceCommand: string;
	complexity?: number;
	filesLikelyTouched?: string[];
}

export type ClineDevTestProjectPreset = "mid_task" | "complex_dag";

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
		"Task: Read specification.md, decompose the requested change into Kanban task leaves, and apply the generated task graph.",
	specification:
		"Update the habit score logic so perfect completion is capped at 100 even with a long streak, and add or update the acceptance test.",
	acceptanceCommand: "npm test",
	complexity: 35,
	filesLikelyTouched: ["src/habit-score.ts", "test/habit-score.test.js"],
};

export const MID_COMPLEXITY_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "habit-insights-mid",
	title: "Add habit insight summaries",
	prompt:
		"Task: Read specification.md, decompose the habit insight summary work into Kanban task leaves, and apply the generated task graph.",
	specification: [
		"Implement a mid-complexity habit insights feature in this TypeScript CLI project.",
		"",
		"Goal:",
		"- Add a reusable weekly habit summary API that combines habit score, completion trend, and a short recommendation.",
		"- Update the CLI output to print the summary in a compact human-readable form.",
		"- Add or update tests that cover improving, declining, and perfect-score capped cases.",
		"",
		"Constraints:",
		"- Keep the implementation small and maintainable.",
		"- Prefer touching src/habit-score.ts, src/habit-insights.ts, src/index.ts, and test/habit-score.test.js.",
		"- Do not add dependencies.",
	].join("\n"),
	acceptanceCommand: "npm test",
	complexity: 62,
	filesLikelyTouched: ["src/habit-score.ts", "src/habit-insights.ts", "src/index.ts"],
};

export const COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "habit-product-cline-complex",
	title: "Habit product Cline buildout",
	prompt:
		"Task: Read specification.md, decompose the product buildout into at least ten Kanban task leaves with dependencies, and apply the generated task graph.",
	specification: [
		"Turn the tiny habit scoring CLI into a more complete habit-insights product slice.",
		"",
		"Expected product capabilities:",
		"- Document the current habit score domain model and extension points.",
		"- Add configurable weekly goal settings with validation.",
		"- Extract reusable trend classification with improving, declining, steady, and insufficient-data outcomes.",
		"- Make recommendations depend on score band, trend, and goal configuration.",
		"- Update the CLI text output to print score, trend, and recommendation.",
		"- Add a --json output mode without adding dependencies.",
		"- Expand tests for improving, declining, steady, invalid-input, and perfect-score capped scenarios.",
		"- Add README usage notes for text and JSON output.",
		"- Keep each generated task independently reviewable and machine-checkable.",
	].join("\n"),
	acceptanceCommand: "npm test",
	complexity: 74,
	filesLikelyTouched: ["src/habit-score.ts", "src/habit-insights.ts", "src/index.ts"],
};

export function resolveClineDevTestProjectScenario(
	preset: ClineDevTestProjectPreset = "mid_task",
): ClineDevTestProjectScenario {
	return preset === "complex_dag" ? COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO : MID_COMPLEXITY_CLINE_DEV_TEST_SCENARIO;
}

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
		join(workspacePath, "specification.md"),
		[
			`# ${scenario.title}`,
			"",
			scenario.specification.trim(),
			"",
			"## Acceptance",
			"",
			`Run \`${scenario.acceptanceCommand}\` successfully.`,
			"",
		].join("\n"),
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
