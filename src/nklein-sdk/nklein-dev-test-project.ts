import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
	specificationPath?: string;
	acceptanceCommand: string;
	complexity?: number;
	filesLikelyTouched?: string[];
	templateName?: string;
}

export type NKleinDevTestProjectPreset =
	| "mid_task"
	| "complex_dag"
	| "audio_vst"
	| "daw_foundation"
	| "wide_fanout"
	| "deep_chain"
	| "mixed_dag"
	| "many_small";

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

export const DAW_FOUNDATION_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "daw-foundation-platform",
	title: "Modern DAW foundation buildout",
	templateName: "daw-foundation",
	specification:
		"Build the professional, cross-platform DAW foundation release described by scripts/dev-fixtures/daw-foundation-spec.md.",
	specificationPath: join("scripts", "dev-fixtures", "daw-foundation-spec.md"),
	prompt: [
		"I want to build a genuinely professional, modern cross-platform DAW — one I would actually choose over Ableton Live, FL Studio, or Bitwig Studio — and I am dead serious about it being release-quality, not a toy and not a fake MVP.",
		"The complete product and engineering specification is in specification.md. Read all of it: it is the authoritative source of truth, and it is intentionally enormous and domain-heavy (real-time audio, DSP and synthesis, psychoacoustics, music theory, VST3 hosting, Web Audio/AudioWorklet, WebGPU, MIDI/MPE, MCP control, linked multi-window/multi-screen workspaces, plugin sandboxing, and cross-platform packaging).",
		"I want this deeply decomposed, like the platform it is — a real, dependency-linked plan across every architecture layer in the spec (domain core, musical engines, DSP/devices, platform adapters, session/control, presentation, automation/MCP), not a small CRUD-style task list. Keep the existing timebase as a real, tested core primitive and build outward from it.",
		"Do the homework: wherever the spec points at a standard, SDK, or algorithm, go learn it properly instead of guessing, and track your knowledge debt explicitly — write down what you do not yet know for the hard domains so it can be filled in.",
		"Build real DSP and real engine code with deterministic, golden tests — no stubs, no hardcoded fakes, and no shallow result pretending to be a DAW. Tests and documentation must depend on the implementation they validate or describe.",
		"I would much rather have fewer parts built to a true state-of-the-art, release-quality bar than a wide layer of placeholders. Take the time and compute you need, and impress me.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 100,
	filesLikelyTouched: ["src/timebase.ts", "src/index.ts", "test/timebase.test.js"],
};

// §5.O parallel-fan-out dev-test projects: DAG-shape stress presets that exercise + benefit from parallel
// multi-agent execution (the swarm executor, sandbox pool, result-branch merges, review/delivery). They reuse
// the small TS CLI template and steer the decomposition toward a specific shape via the prompt.

export const WIDE_FANOUT_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-wide-fanout",
	title: "Wide fan-out formatter build",
	specification: [
		"Extend the habit scoring CLI with INDEPENDENT, non-overlapping output formatters that can be built in parallel.",
		"",
		"Expected capabilities:",
		"- Add several independent formatters, each in its own file under src/formatters/ with its own test, turning a habit score into a different representation: a compact line, a JSON object, a CSV row, a markdown table row, an emoji sparkline, and a plain-text report.",
		"- No formatter may import or depend on another formatter.",
		"- Add a single registry card that wires every formatter into the CLI (depends on all formatters).",
		"- Add one broad integration test card (depends on the registry).",
	].join("\n"),
	prompt: [
		"Create a WIDE, parallel implementation-card breakdown for the formatter work in specification.md.",
		"The shape must fan out wide: produce many INDEPENDENT formatter cards that do not depend on each other, plus exactly two join points at the end.",
		"Use this outline unless the files prove it impossible: cards 1-6 are independent formatters (compact line, JSON, CSV, markdown row, emoji sparkline, plain-text report) — each in its own file under src/formatters/ with its own test, and NONE depending on another; card 7 is a formatter registry that wires all six into the CLI and depends on cards 1-6; card 8 is a broad integration test that depends on card 7.",
		"Do not serialize the independent formatters into a chain — they must be parallelizable. Only the registry and the integration test have dependencies.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 66,
	filesLikelyTouched: ["src/formatters", "src/index.ts", "test/formatters.test.js"],
};

export const DEEP_CHAIN_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-deep-chain",
	title: "Deep dependency chain pipeline",
	specification: [
		"Build a strictly linear habit-data processing pipeline where each stage consumes the previous stage's typed output.",
		"",
		"Expected pipeline (each stage depends on the one before it):",
		"- parse raw entries -> normalize -> validate -> score -> classify trend -> derive recommendation -> format output -> emit summary.",
		"- Each stage lives in its own file and consumes the type produced by the previous stage, so the work cannot be parallelized.",
		"- Add a final end-to-end test that runs the whole pipeline (depends on the last stage).",
	].join("\n"),
	prompt: [
		"Create a DEEP, strictly linear implementation-card breakdown for the pipeline in specification.md.",
		"The shape must be a single dependency chain with almost no parallelism: each card depends on the immediately preceding card.",
		"Use this outline unless the files prove it impossible: 1 parse raw entries, 2 normalize (depends on 1), 3 validate (depends on 2), 4 score (depends on 3), 5 classify trend (depends on 4), 6 derive recommendation (depends on 5), 7 format output (depends on 6), 8 emit summary (depends on 7), 9 end-to-end pipeline test (depends on 8).",
		"Do not split stages into independent parallel branches — each stage genuinely consumes the previous stage's output type.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 70,
	filesLikelyTouched: ["src/pipeline", "src/index.ts", "test/pipeline.test.js"],
};

export const MIXED_DAG_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-mixed-dag",
	title: "Mixed DAG feature slice",
	specification: [
		"Extend the habit CLI with a feature slice that mixes independent parallel branches, a shared dependency, and join points (a realistic diamond-shaped DAG).",
		"",
		"Expected capabilities:",
		"- A shared domain/config module that several features build on.",
		"- Two independent parallel branches built on the shared module: a goals branch and a streak-analytics branch, each with its own implementation and tests.",
		"- A reporting feature that joins both branches.",
		"- Broad tests and a README that depend on the reporting feature.",
	].join("\n"),
	prompt: [
		"Create a MIXED-shape implementation-card breakdown for specification.md: some cards run in parallel, some share a dependency, and some are join points (a diamond DAG).",
		"Use this outline unless the files prove it impossible: 1 shared domain/config module (root); a goals branch (2 settings depends on 1, 3 goal logic depends on 2); a parallel streak-analytics branch (4 depends on 1, 5 depends on 4); 6 reporting feature depends on BOTH 3 and 5 (the join); 7 broad tests depend on 6; 8 README depends on 6.",
		"Branches 2-3 and 4-5 must be independent of each other so they can run in parallel; the reporting card is the join point.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 72,
	filesLikelyTouched: ["src/habit-score.ts", "src/habit-insights.ts", "src/index.ts"],
};

export const MANY_SMALL_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-many-small",
	title: "Many tiny cards stress",
	specification: [
		"Add a large number of tiny, independent, single-purpose helpers to the habit CLI to stress parallel execution.",
		"",
		"Expected capabilities:",
		"- Add at least twenty tiny pure helper functions (e.g., clamp, percent, round-half-up, day-of-week, streak-bucket, label-for-band, ...), each in its own small file under src/helpers/ with one focused test.",
		"- Each helper is independent — no helper imports another.",
		"- Add a single barrel card that re-exports every helper (depends on all of them).",
	].join("\n"),
	prompt: [
		"Create a breakdown with MANY tiny, independent implementation cards for specification.md to stress parallel execution and the sandbox pool.",
		"Produce at least twenty small helper cards, each adding one tiny pure function in its own file under src/helpers/ with one focused test, and NONE depending on another helper.",
		"Add exactly one final barrel card that re-exports every helper and depends on all of them.",
		"Keep each card tiny and independently reviewable; do not merge helpers together or introduce dependencies between them.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	acceptanceCommand: "npm test",
	complexity: 58,
	filesLikelyTouched: ["src/helpers", "src/index.ts"],
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
	if (preset === "daw_foundation") {
		return DAW_FOUNDATION_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "wide_fanout") {
		return WIDE_FANOUT_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "deep_chain") {
		return DEEP_CHAIN_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "mixed_dag") {
		return MIXED_DAG_NKLEIN_DEV_TEST_SCENARIO;
	}
	if (preset === "many_small") {
		return MANY_SMALL_NKLEIN_DEV_TEST_SCENARIO;
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
	const specification = scenario.specificationPath
		? await readFile(join(getRepoRootFromCurrentModule(), scenario.specificationPath), "utf8")
		: scenario.specification;
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
			specification.trim(),
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
