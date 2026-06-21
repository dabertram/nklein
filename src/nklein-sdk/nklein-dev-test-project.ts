import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TEMPLATE_NAME = "smoke-ts-cli";
export const NKLEIN_DEV_TEST_PROJECT_MARKER_PATH = join(".nklein", "nklein", "dev-test-project.json");

export interface NKleinDevTestProjectScenario {
	id: string;
	title: string;
	prompt: string;
	specification: string;
	acceptanceCommand: string;
	complexity?: number;
	filesLikelyTouched?: string[];
	templateName?: string;
}

export type NKleinDevTestProjectPreset = "mid_task" | "complex_dag" | "audio_vst";

export interface ScaffoldNKleinDevTestProjectOptions {
	scenario?: NKleinDevTestProjectScenario;
	parentDir?: string;
	templateName?: string;
	initializeGit?: boolean;
	now?: () => number;
}

export interface ScaffoldedNKleinDevTestProject {
	workspacePath: string;
	templatePath: string;
	scenario: NKleinDevTestProjectScenario;
	acceptanceCommand: string;
	gitInitialized: boolean;
}

export interface NKleinDevTestProjectMarker {
	createdBy: "nklein-dev-test";
	scenarioId: string;
	scenarioTitle: string;
	createdAt: number;
}

const PRODUCT_PROMPT_SUFFIX =
	"Use specification.md as the authoritative product specification. Keep generated implementation cards independently reviewable and machine-checkable. Acceptance command: npm test.";

export const DEFAULT_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "small-model-smoke",
	title: "Small model smoke task",
	prompt: `Create a small implementation-card breakdown for the requested change in specification.md. ${PRODUCT_PROMPT_SUFFIX}`,
	specification:
		"Update the habit score logic so perfect completion is capped at 100 even with a long streak, and add or update the acceptance test.",
	acceptanceCommand: "npm test",
	complexity: 35,
	filesLikelyTouched: ["src/habit-score.ts", "test/habit-score.test.js"],
};

export const MID_COMPLEXITY_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-insights-mid",
	title: "Add habit insight summaries",
	prompt: `Create a dependent implementation-card breakdown for the habit insight summary work in specification.md. ${PRODUCT_PROMPT_SUFFIX}`,
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

export const COMPLEX_DAG_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-product-nklein-complex",
	title: "Habit product !Klein buildout",
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
		"Create at least ten dependent implementation cards for the product buildout described in specification.md.",
		"The required capabilities are exactly:",
		"- Document the current habit score domain model and extension points.",
		"- Add configurable weekly goal settings with validation.",
		"- Extract reusable trend classification with improving, declining, steady, and insufficient-data outcomes.",
		"- Make recommendations depend on score band, trend, and goal configuration.",
		"- Update the CLI text output to print score, trend, and recommendation.",
		"- Add a --json output mode without adding dependencies.",
		"- Expand tests for improving, declining, steady, invalid-input, and perfect-score capped scenarios.",
		"- Add README usage notes for text and JSON output.",
		"Use this 12-card outline unless the files prove it impossible: 1 document domain model, 2 parse --goal, 3 validate goal settings, 4 classify trends, 5 integrate goals into insights, 6 classify score bands, 7 define recommendation inputs, 8 implement recommendations, 9 update text output, 10 add --json output, 11 expand tests, 12 update README.",
		"Tests must depend on the implementation cards they validate. README work must depend on the user-facing CLI output cards it describes.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 74,
	filesLikelyTouched: ["src/habit-score.ts", "src/habit-insights.ts", "src/index.ts"],
};

export const AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
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
		"Create at least ten dependent implementation cards for the audio plugin buildout described in specification.md.",
		"This is a domain-knowledge-heavy task. The card breakdown should make knowledge assumptions explicit for audio synthesis, psytrance kick/bass design, phase alignment, four-beat groove timing, music theory, and effect guardrails.",
		"Use this 12-card outline unless the files prove it impossible: 1 document DSP/plugin domain model and knowledge assumptions, 2 define kick synthesis controls, 3 implement clean kick rendering, 4 define bass synthesis controls, 5 implement clean bass rendering, 6 implement phase-aligned four-beat sequence timing, 7 add sequence rendering tests, 8 define modern UI control metadata/state, 9 implement UI-state API, 10 add clean effects with guardrails, 11 expand audio quality/phase/effect tests, 12 update README usage notes.",
		"Sequence work must depend on kick and bass rendering. UI work must depend on exposed controls. Effect work must depend on the dry kick, bass, and sequence APIs. Broad tests and README work must depend on the implementation cards they validate or describe.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 75,
	filesLikelyTouched: ["src/plugin.ts", "src/index.ts", "test/plugin.test.js"],
};

export function resolveNKleinDevTestProjectScenario(
	preset: NKleinDevTestProjectPreset = "mid_task",
): NKleinDevTestProjectScenario {
	if (preset === "complex_dag") {
		return COMPLEX_DAG_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "audio_vst") {
		return AUDIO_VST_NKLEIN_DEV_TEST_SCENARIO;
	}
	return MID_COMPLEXITY_NKLEIN_DEV_TEST_SCENARIO;
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

export function resolveNKleinDevTestTemplatePath(templateName = DEFAULT_TEMPLATE_NAME): string {
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

export async function scaffoldNKleinDevTestProject(
	options: ScaffoldNKleinDevTestProjectOptions = {},
): Promise<ScaffoldedNKleinDevTestProject> {
	const scenario = options.scenario ?? DEFAULT_NKLEIN_DEV_TEST_SCENARIO;
	const parentDir = options.parentDir ?? tmpdir();
	const now = options.now ?? Date.now;
	const createdAt = now();
	const workspacePath = await mkdtemp(join(parentDir, `nklein-${slugify(scenario.id)}-${createdAt}-`));
	const templatePath = resolveNKleinDevTestTemplatePath(options.templateName ?? scenario.templateName);
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
	const marker: NKleinDevTestProjectMarker = {
		createdBy: "nklein-dev-test",
		scenarioId: scenario.id,
		scenarioTitle: scenario.title,
		createdAt,
	};
	const markerPath = join(workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH);
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
