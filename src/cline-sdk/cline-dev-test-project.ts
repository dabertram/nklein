import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TEMPLATE_NAME = "smoke-ts-cli";
export const CLINE_DEV_TEST_PROJECT_MARKER_PATH = join(".cline", "nklein", "dev-test-project.json");

export interface ClineDevTestProjectScenario {
	id: string;
	title: string;
	prompt: string;
	specification: string;
	acceptanceCommand: string;
	complexity?: number;
	filesLikelyTouched?: string[];
	templateName?: string;
}

export type ClineDevTestProjectPreset = "mid_task" | "complex_dag" | "audio_vst";

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

export interface ClineDevTestProjectMarker {
	createdBy: "nklein-dev-test";
	scenarioId: string;
	scenarioTitle: string;
	createdAt: number;
}

const DECOMPOSE_PROMPT_SUFFIX =
	"Use workspace-relative paths such as `specification.md` and treat that file as the authoritative product specification. Do not invent replacement requirements or alternate input fields that are not in the specification or existing code. If a generated leaf uses `testFirst: true`, include a concrete `acceptanceTestPrompt`; otherwise set `testFirst: false`.";

export const DEFAULT_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "small-model-smoke",
	title: "Small model smoke task",
	prompt: `Task: Read specification.md, decompose the requested change into !Klein task leaves, and apply the generated task graph. ${DECOMPOSE_PROMPT_SUFFIX}`,
	specification:
		"Update the habit score logic so perfect completion is capped at 100 even with a long streak, and add or update the acceptance test.",
	acceptanceCommand: "npm test",
	complexity: 35,
	filesLikelyTouched: ["src/habit-score.ts", "test/habit-score.test.js"],
};

export const MID_COMPLEXITY_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "habit-insights-mid",
	title: "Add habit insight summaries",
	prompt: `Task: Read specification.md, decompose the habit insight summary work into !Klein task leaves, and apply the generated task graph. ${DECOMPOSE_PROMPT_SUFFIX}`,
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
	prompt: [
		"Task: Read specification.md, decompose the product buildout into at least ten !Klein task leaves with dependencies, and apply the generated task graph.",
		"When calling decompose_project, pass `minimumTaskCount: 10`.",
		"After one focused pass over specification.md and the small source/test/package files, call decompose_project immediately; do not write a markdown implementation plan in chat before the tool call.",
		"The required capabilities are exactly:",
		"- Document the current habit score domain model and extension points.",
		"- Add configurable weekly goal settings with validation.",
		"- Extract reusable trend classification with improving, declining, steady, and insufficient-data outcomes.",
		"- Make recommendations depend on score band, trend, and goal configuration.",
		"- Update the CLI text output to print score, trend, and recommendation.",
		"- Add a --json output mode without adding dependencies.",
		"- Expand tests for improving, declining, steady, invalid-input, and perfect-score capped scenarios.",
		"- Add README usage notes for text and JSON output.",
		"Use this 12-leaf outline unless the files prove it impossible: 1 document domain model, 2 parse --goal, 3 validate goal settings, 4 classify trends, 5 integrate goals into insights, 6 classify score bands, 7 define recommendation inputs, 8 implement recommendations, 9 update text output, 10 add --json output, 11 expand tests, 12 update README.",
		"Dependency requirements: task 11 (expand tests) must depend on every implementation leaf it validates: tasks 2, 3, 4, 5, 6, 7, 8, 9, and 10. Task 12 (README) must depend on the user-facing CLI output leaves: tasks 9 and 10. Do not make broad test or documentation cards runnable before the implementation cards they verify or describe.",
		"If decompose_project rejects the graph for count or sizing, retry decompose_project immediately with smaller leaves. After a successful apply, stop the planning card; do not inspect .cline/nklein plan artifact paths.",
		DECOMPOSE_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 74,
	filesLikelyTouched: ["src/habit-score.ts", "src/habit-insights.ts", "src/index.ts"],
};

export const AUDIO_VST_CLINE_DEV_TEST_SCENARIO: ClineDevTestProjectScenario = {
	id: "audio-vst-psytrance",
	title: "Psytrance audio VST buildout",
	templateName: "audio-vst-synth",
	specification: [
		"Turn the tiny TypeScript DSP prototype into a VST-style audio plugin core for modern psytrance grooves.",
		"",
		"Expected product capabilities:",
		"- Generate clean kick and bass sounds suitable for modern psytrance, with clear transients and controlled low end.",
		"- Generate a four-beat sequence with a clean, phase-aligned kick/bass pattern.",
		"- Add a simple, intuitive, modern UI-state model for every exposed feature/control.",
		"- Add effects only with guardrails that preserve psytrance groove clarity, transient definition, and low-end phase alignment.",
		"- Include tests that check bounded output, deterministic rendering, phase alignment, clean low-end behavior, sequence timing, UI control metadata, and effect guardrails.",
		"- Do not add dependencies or require an actual DAW/VST host; implement a portable VST-style DSP/plugin core with testable TypeScript APIs.",
	].join("\n"),
	prompt: [
		"Task: Read specification.md, decompose the audio plugin buildout into at least ten !Klein task leaves with dependencies, and apply the generated task graph.",
		"When calling decompose_project, pass `minimumTaskCount: 10`.",
		"This is a domain-knowledge-heavy task. Before decomposing, make one focused pass over specification.md and the small source/test/package files, then explicitly reason about missing knowledge in audio synthesis, psytrance kick/bass design, phase alignment, four-beat groove timing, music theory, and effect guardrails.",
		"Use local code/index knowledge tools for codebase orientation. If sanctioned knowledge or web-fetch tools are available, use them only for concise domain lookup and cite the lookup in the plan; if they are unavailable, record explicit assumptions instead of pretending certainty.",
		"Use this 12-leaf outline unless the files prove it impossible: 1 document DSP/plugin domain model and knowledge assumptions, 2 define kick synthesis controls, 3 implement clean kick rendering, 4 define bass synthesis controls, 5 implement clean bass rendering, 6 implement phase-aligned four-beat sequence timing, 7 add sequence rendering tests, 8 define modern UI control metadata/state, 9 implement UI-state API, 10 add clean effects with guardrails, 11 expand audio quality/phase/effect tests, 12 update README usage notes.",
		"Dependency requirements: sequence work must depend on kick and bass rendering; UI work must depend on exposed controls; effect work must depend on the dry kick/bass/sequence APIs; broad tests and README must depend on the implementation leaves they validate or describe.",
		"If decompose_project rejects the graph for count or sizing, retry decompose_project immediately with smaller leaves. After a successful apply, stop the planning card; do not inspect .cline/nklein plan artifact paths.",
		DECOMPOSE_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 75,
	filesLikelyTouched: ["src/plugin.ts", "src/index.ts", "test/plugin.test.js"],
};

export function resolveClineDevTestProjectScenario(
	preset: ClineDevTestProjectPreset = "mid_task",
): ClineDevTestProjectScenario {
	if (preset === "complex_dag") {
		return COMPLEX_DAG_CLINE_DEV_TEST_SCENARIO;
	}
	if (preset === "audio_vst") {
		return AUDIO_VST_CLINE_DEV_TEST_SCENARIO;
	}
	return MID_COMPLEXITY_CLINE_DEV_TEST_SCENARIO;
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
			GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "!Klein Dev Test",
			GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "kanban-dev-test@example.invalid",
			GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "!Klein Dev Test",
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
	const createdAt = now();
	const workspacePath = await mkdtemp(join(parentDir, `nklein-${slugify(scenario.id)}-${createdAt}-`));
	const templatePath = resolveClineDevTestTemplatePath(options.templateName ?? scenario.templateName);
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
	const marker: ClineDevTestProjectMarker = {
		createdBy: "nklein-dev-test",
		scenarioId: scenario.id,
		scenarioTitle: scenario.title,
		createdAt,
	};
	const markerPath = join(workspacePath, CLINE_DEV_TEST_PROJECT_MARKER_PATH);
	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
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
