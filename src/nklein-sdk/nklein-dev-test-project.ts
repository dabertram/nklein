import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isPathInsideGitWorkTree, resolveSafeCreatedWorkspaceParentDir } from "../config/workspace-location";

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
	/**
	 * Requested parent directory for the created workspace. Honored ONLY if it is not at/below !Klein's parent
	 * folder; an unsafe request is redirected to a safe base (see resolveSafeCreatedWorkspaceParentDir). Omit to use
	 * the configured/home-default safe base.
	 */
	parentDir?: string;
	/** User-configured safe base dir (global setting) for created workspaces; overridden by a safe `parentDir`. */
	workspaceBaseDir?: string;
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
	/** Non-null when an unsafe requested/configured parent dir was redirected to a safe base (reason for logging). */
	parentDirSafetyRedirect: string | null;
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
	prompt: `Create a small implementation-card breakdown for the bug fix described in specification.md. ${PRODUCT_PROMPT_SUFFIX}`,
	specification: [
		"Fix a scoring bug in this tiny TypeScript habit-tracker CLI.",
		"",
		"Domain:",
		"- `calculateHabitScore({ completedDays, targetDays, streakDays })` in src/habit-score.ts returns an integer",
		"  0-100. It is the completion ratio (completedDays / targetDays) plus a small streak bonus, scaled to 100.",
		"",
		"The bug:",
		"- When a user completes every day AND has a long streak, the streak bonus pushes the score above 100.",
		"  A score over 100 is meaningless and breaks downstream display. The score must be capped at 100.",
		"",
		"Required invariant (the acceptance test must assert it):",
		"- For every input, 0 <= calculateHabitScore(...) <= 100.",
		"- A perfect week (completedDays === targetDays) with any streakDays still returns exactly 100, never more.",
		"- An empty or zero target (targetDays <= 0) returns 0 (already handled; keep it).",
		"",
		"Constraints:",
		"- Touch only src/habit-score.ts and test/habit-score.test.js. Do not add dependencies.",
		"- Keep the existing passing tests green; add the perfect-score-capped case.",
	].join("\n"),
	acceptanceCommand: "npm test",
	complexity: 35,
	filesLikelyTouched: ["src/habit-score.ts", "test/habit-score.test.js"],
};

export const MID_COMPLEXITY_NKLEIN_DEV_TEST_SCENARIO: NKleinDevTestProjectScenario = {
	id: "habit-insights-mid",
	title: "Add habit insight summaries",
	prompt: [
		"Create a dependent implementation-card breakdown for the habit insight summary work in specification.md.",
		"Build it bottom-up so each card is independently reviewable: the scoring cap and the trend classifier are",
		"the foundation; the weekly summary depends on both; the CLI output and tests depend on the summary.",
		PRODUCT_PROMPT_SUFFIX,
	].join(" "),
	specification: [
		"Implement a mid-complexity habit insights feature in this TypeScript CLI project.",
		"",
		"Domain model (existing):",
		"- `calculateHabitScore({ completedDays, targetDays, streakDays }) -> number` (src/habit-score.ts): an integer",
		"  0-100, completion ratio plus a capped streak bonus.",
		"- `summarizeHabitWeek({ ...score input, previousCompletedDays }) -> { score, trend, recommendation }`",
		"  (src/habit-insights.ts): the reusable weekly summary you are extending.",
		"",
		"Goal:",
		"- Make `calculateHabitScore` clamp its result to 0-100 (a perfect week with a long streak must return 100).",
		"- Classify the week's `trend` from the completion delta (`completedDays - previousCompletedDays`):",
		"  `improving` when the delta is positive, `declining` when negative, `steady` when zero.",
		"- Produce a short, deterministic `recommendation` string keyed off the trend.",
		"- Update the CLI output (src/index.ts) to print score, trend, and recommendation in a compact human-readable form.",
		"",
		"Invariants the acceptance test must assert (deterministic, no randomness):",
		"- 0 <= score <= 100 for every input; a perfect week is exactly 100.",
		"- trend is exactly one of improving | declining | steady and matches the sign of the completion delta.",
		"- The same input always yields the same summary (pure function, stable recommendation text).",
		"",
		"Constraints:",
		"- Keep the implementation small and maintainable. Prefer pure functions with typed inputs/outputs.",
		"- Touch src/habit-score.ts, src/habit-insights.ts, src/index.ts, and test/habit-score.test.js.",
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
		"Turn the tiny habit scoring CLI into a more complete, well-typed habit-insights product slice.",
		"",
		"Domain entities (define these as typed TypeScript interfaces):",
		"- `HabitScoreInput { completedDays, targetDays, streakDays }` and the existing `calculateHabitScore`.",
		"- `GoalSettings { weeklyTargetDays: number; minStreakForBonus: number }` — validated user configuration.",
		"- `TrendClass = 'improving' | 'declining' | 'steady' | 'insufficient-data'`.",
		"- `ScoreBand = 'low' | 'fair' | 'good' | 'excellent'` derived from the 0-100 score.",
		"- `Recommendation { text: string; reason: string }` derived from (band, trend, goal).",
		"",
		"Expected product capabilities:",
		"- Document the current habit score domain model and extension points.",
		"- Add configurable weekly goal settings with validation.",
		"- Extract reusable trend classification with improving, declining, steady, and insufficient-data outcomes.",
		"- Classify the 0-100 score into bands (low/fair/good/excellent) with documented, non-overlapping thresholds.",
		"- Make recommendations depend on score band, trend, and goal configuration.",
		"- Update the CLI text output to print score, trend, and recommendation.",
		"- Add a --json output mode without adding dependencies.",
		"- Expand tests for improving, declining, steady, invalid-input, and perfect-score capped scenarios.",
		"- Add README usage notes for text and JSON output.",
		"- Keep each generated task independently reviewable and machine-checkable.",
		"",
		"Validation rules (must be enforced and tested):",
		"- `weeklyTargetDays` is an integer in 1..7; `minStreakForBonus` is an integer >= 0. Invalid settings throw a",
		"  typed error with a clear message — they never silently clamp.",
		"- `insufficient-data` is returned only when there is no prior week to compare against; otherwise the trend is",
		"  one of improving/declining/steady from the completion delta.",
		"",
		"Invariants the acceptance test must assert (deterministic — no randomness, no clock, no network):",
		"- 0 <= score <= 100 for every input; a perfect week (completedDays === targetDays) is exactly 100.",
		"- Score bands partition 0..100 with no gaps and no overlaps; every score maps to exactly one band.",
		"- Text output and --json output describe the SAME underlying summary for the same input (no divergence).",
		"- Every public function is pure: identical input always yields identical output (stable recommendation text).",
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
		"Honor the real dependency edges so the DAG is correct: card 5 (integrate goals) depends on 3 (validate) and 4 (classify trends); card 8 (recommendations) depends on 6 (score bands) and 7 (recommendation inputs); cards 9 and 10 (text + JSON output) depend on 8; card 11 (tests) depends on every implementation card it validates; card 12 (README) depends on the user-facing CLI output cards (9 and 10) it describes.",
		"Each card must define or extend exactly one typed entity/function so it is independently reviewable and machine-checkable; do not collapse multiple capabilities into one card or invent dependencies that are not real.",
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
		"Starting point (already in the repo): `renderKick`, `renderBass`, and `peakLevel` in src/plugin.ts produce",
		"deterministic Float32Array buffers from typed voice settings. Grow this into a small but real plugin core.",
		"",
		"Domain model (define these as typed interfaces — no `any`):",
		"- `RenderedBuffer { sampleRate: number; samples: Float32Array }` — the universal mono audio unit.",
		"- `KickVoiceSettings` / `BassVoiceSettings` — the synthesis parameters (extend the existing ones).",
		"- `SequenceStep { voice: 'kick' | 'bass'; startTick: number }` and a 4-on-the-floor pattern at a given BPM.",
		"- `ControlSpec { id; label; min; max; default; unit }` — UI metadata for every exposed parameter.",
		"- `EffectSettings` for any effect (e.g. saturation, filter), with a documented safe parameter range.",
		"",
		"Expected product capabilities:",
		"- Generate clean kick and bass sounds suitable for modern psytrance, with clear transients and controlled low end.",
		"- Generate a four-beat sequence with a clean, phase-aligned kick/bass pattern.",
		"- Add a simple, intuitive, modern UI-state model for every exposed feature/control.",
		"- Add effects only with guardrails that preserve psytrance groove clarity, transient definition, and low-end phase alignment.",
		"- Include tests that check bounded output, deterministic rendering, phase alignment, clean low-end behavior, sequence timing, UI control metadata, and effect guardrails.",
		"- Do not add dependencies or require an actual DAW/VST host; implement a portable VST-style DSP/plugin core with testable TypeScript APIs.",
		"",
		"Audio invariants the acceptance test must assert (deterministic — fixed sample rate + seedless math, no live audio):",
		"- Every rendered buffer is bounded: |sample| <= 1 for all samples (no clipping past full scale).",
		"- Rendering is a pure function of its settings: the same settings always produce a byte-identical buffer.",
		"- The kick's onset (transient) is its highest-energy region; the kick decays toward silence by the end of the buffer.",
		"- In the sequence, kick and bass that share a beat start in phase (the bass does not begin mid-cycle against the kick),",
		"  so the four-beat groove stays phase-aligned and the low end does not cancel.",
		"- An effect with parameters inside its declared safe range never raises the peak level above 1 (the guardrail holds).",
		"",
		"Knowledge assumptions to make explicit (track what you do not know rather than guessing):",
		"- psytrance kick/bass design, transient shaping, phase alignment, four-on-the-floor timing at a given BPM, and",
		"  what 'clean low end' means (mono-compatible, phase-coherent, no sub cancellation).",
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
		"",
		"Shared contract (define once, e.g. in src/formatters/types.ts, so every formatter is interchangeable):",
		"- `interface HabitView { score: number; trend: 'improving' | 'declining' | 'steady'; recommendation: string }`",
		"- `type Formatter = (view: HabitView) => string` — a pure function from the view to a string representation.",
		"",
		"Per-formatter invariants the tests must assert (each formatter is pure and total):",
		"- A formatter is total and pure: it returns a non-empty string for every valid HabitView and never throws.",
		"- The JSON formatter emits valid JSON that round-trips back to the same view fields; the CSV row has a stable",
		"  column count; the markdown row is a single valid table row; the sparkline length is stable for a given score.",
		"- Registry invariant: the registry exposes every formatter exactly once under a unique key, with no collisions.",
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
		"",
		"Stage contract (each stage is a pure function `(input: PrevOutput) => NextOutput`, types living in src/pipeline/):",
		"- parse: `string[] -> RawEntry[]`; normalize: `RawEntry[] -> NormalizedEntry[]`; validate: `NormalizedEntry[] ->",
		"  ValidEntry[]` (drops/flags malformed rows, never throws on bad input); score: `ValidEntry[] -> number` (0-100);",
		"  classifyTrend: `number history -> 'improving' | 'declining' | 'steady'`; recommend: `(score, trend) -> string`;",
		"  format: `Summary -> string`; emit: `string -> { ok: true; output: string }`.",
		"",
		"Invariants the end-to-end test must assert (deterministic — same input string array always yields the same summary):",
		"- The pipeline is a total function on well-formed input and degrades gracefully (no throw) on malformed rows.",
		"- The final score is always 0-100; the trend is exactly one of improving/declining/steady.",
		"- Each stage's output type is exactly the next stage's input type — the chain type-checks end to end with no `any`.",
		"- Running the whole pipeline twice on the same input produces identical output (purity / referential transparency).",
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
		"",
		"Module contract (the diamond — shared root, two independent arms, one join):",
		"- Shared root `src/core/config.ts`: `interface HabitConfig { weeklyTargetDays: number }` + a validator. Both arms",
		"  import ONLY from here, never from each other.",
		"- Goals arm `src/goals/`: turns config into goal progress (e.g. `goalProgress(config, completedDays) -> number`).",
		"- Streak-analytics arm `src/analytics/`: derives streak stats (e.g. `streakStats(days: number[]) -> { current; best }`).",
		"- Reporting `src/report/`: `buildReport(goals, analytics) -> Report` — the ONLY module that imports both arms.",
		"",
		"Invariants the tests must assert (deterministic; the two arms are independently testable in isolation):",
		"- The goals arm and the analytics arm have no import of one another (the diamond's arms stay parallel).",
		"- Invalid config throws a typed error from the shared validator; both arms rely on already-valid config.",
		"- `buildReport` is a pure join: identical (goals, analytics) inputs always yield an identical Report.",
		"- The report exposes data from BOTH arms (goal progress AND streak stats) — neither arm is dropped at the join.",
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
		"",
		"Helper contract (every helper is a small, pure, total function with a typed signature and a documented domain):",
		"- e.g. `clamp(value: number, lo: number, hi: number) -> number`, `percent(part: number, whole: number) -> number`,",
		"  `roundHalfUp(value: number) -> number`, `dayOfWeek(index: number) -> string`, `streakBucket(days: number) -> string`,",
		"  `labelForBand(score: number) -> string`. Each helper lives in its own file under src/helpers/ with one focused test.",
		"",
		"Invariants the tests must assert (each helper is independently checkable; the barrel just re-exports):",
		"- Every helper is pure and total: defined for its whole documented input domain and never throws on valid input.",
		"- No helper imports another helper (verifiable by inspecting each file's imports) — they are fully parallelizable.",
		"- The barrel re-exports every helper exactly once with no name collisions, and importing the barrel pulls in all of them.",
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
	// HARD BACKSTOP against the dev-test pollution incident: never `git init`/commit inside an existing git work tree
	// (the !Klein repo or one of its `.claude/worktrees/*` checkouts). The resolver should already keep us out, but a
	// `git init` here would otherwise seed fixture commits + flip `core.bare` on the shared repo. Fail loudly instead.
	if (isPathInsideGitWorkTree(workspacePath)) {
		throw new Error(
			`Refusing to initialize a git repo at "${workspacePath}": it is inside an existing git work tree. ` +
				"Created workspaces must live outside any repo (see resolveSafeCreatedWorkspaceParentDir).",
		);
	}
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
	// SAFETY (isolation invariant): a created workspace must never live at/below !Klein's parent folder, or its
	// git init/commit pollutes the dev repo + sibling worktrees. Honor a safe requested/configured path, else fall
	// back to the home-default safe base (and ensure it exists, since it may not on first use).
	const safeParent = resolveSafeCreatedWorkspaceParentDir({
		requestedParentDir: options.parentDir ?? null,
		configuredBaseDir: options.workspaceBaseDir ?? null,
	});
	const parentDir = safeParent.parentDir;
	await mkdir(parentDir, { recursive: true });
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
		parentDirSafetyRedirect: safeParent.redirected ? safeParent.reason : null,
	};
}
