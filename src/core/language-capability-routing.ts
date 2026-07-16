/**
 * Language- & task-type-aware model-size routing (F12.83, todo §5.AF / Phase 12).
 *
 * `estimateTaskDifficulty` (task-difficulty-estimate.ts) picks a model by an easy/medium/hard tier — but difficulty is
 * ORTHOGONAL to the language capability floor that SWE-bench-Multilingual makes stark: agents resolve ~63% of Python issues
 * but only ~29% of C/C++ and ~31% of Go; 7B models are genuinely strong on Python/JS/TS yet compiled/systems languages need
 * 32B+. Separately, small-model TOOL-CALLING coherence collapses after 2–3 steps, so any multi-file / refactor / long
 * agentic card needs ≥14B regardless of how "easy" the change looks. An easy Rust card is still a Rust card.
 *
 * This is the PURE decision core: from the touched file paths + a coarse task shape it derives a recommended MINIMUM model
 * size (billions of parameters). It does NOT pick a concrete model — it hands a floor to the existing router/fitness prior,
 * which selects the cheapest free model at or above the floor, then lets difficulty choose within that set. No I/O, no clock.
 */

export type ProgrammingLanguage =
	| "python"
	| "javascript"
	| "typescript"
	| "java"
	| "ruby"
	| "php"
	| "csharp"
	| "go"
	| "rust"
	| "c"
	| "cpp"
	| "unknown";

/** File extension (no dot, lowercase) → language. Only genuine source extensions are mapped; data/docs are ignored. */
const EXTENSION_LANGUAGE: Readonly<Record<string, ProgrammingLanguage>> = {
	py: "python",
	pyi: "python",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	ts: "typescript",
	tsx: "typescript",
	mts: "typescript",
	cts: "typescript",
	java: "java",
	rb: "ruby",
	php: "php",
	cs: "csharp",
	go: "go",
	rs: "rust",
	c: "c",
	h: "c",
	cc: "cpp",
	cpp: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hh: "cpp",
	hxx: "cpp",
};

/**
 * Minimum model size (billions) at which a language becomes tractable, from SWE-bench-Multilingual / McEval:
 *   - Python/JS/TS: 7B is genuinely capable (high-resource, best tool-call training data).
 *   - Java/Ruby/PHP/C#/Go: mid tier — 14B floor (lower resolve rates, more environment friction).
 *   - Rust/C/C++: compiled/systems — 32B floor (consistently the weakest languages for agents).
 *   - Unknown: conservative 14B middle.
 */
const LANGUAGE_FLOOR_B: Readonly<Record<ProgrammingLanguage, number>> = {
	python: 7,
	javascript: 7,
	typescript: 7,
	java: 14,
	ruby: 14,
	php: 14,
	csharp: 14,
	go: 14,
	rust: 32,
	c: 32,
	cpp: 32,
	unknown: 14,
};

export type CodingTaskType = "single-file-edit" | "bug-fix" | "multi-file" | "refactor" | "agentic";

/**
 * Task-shape floor from the tool-calling-coherence finding: bounded single-file edits/bug-fixes place no extra floor (a
 * capable small model handles them), but multi-file changes, refactors, and long agentic loops need ≥14B because sub-7B
 * models lose coherence after 2–3 tool steps and over-eagerly call tools.
 */
const TASK_TYPE_FLOOR_B: Readonly<Record<CodingTaskType, number>> = {
	"single-file-edit": 0,
	"bug-fix": 0,
	"multi-file": 14,
	refactor: 14,
	agentic: 14,
};

/** One detected language and how many touched files it accounts for. */
export interface LanguageTally {
	readonly language: ProgrammingLanguage;
	readonly files: number;
}

function extensionOf(path: string): string {
	// Basename to avoid a directory dot; last dot-segment; lowercased.
	const base = path.split(/[\\/]/).pop() ?? path;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Tally the source languages across the given file paths, most-frequent first (ties broken alphabetically for
 * determinism). Non-source files (no recognised code extension) are ignored — they neither add a language nor a floor.
 */
export function detectLanguages(filePaths: readonly string[]): LanguageTally[] {
	const counts = new Map<ProgrammingLanguage, number>();
	for (const path of filePaths) {
		const language = EXTENSION_LANGUAGE[extensionOf(path)];
		if (language) {
			counts.set(language, (counts.get(language) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.map(([language, files]) => ({ language, files }))
		.sort((a, b) => (b.files !== a.files ? b.files - a.files : a.language.localeCompare(b.language)));
}

export interface ModelFloorInput {
	/** Paths of the files the card will touch (relative or absolute; only the extension is read). */
	readonly filePaths: readonly string[];
	/** Coarse task shape; defaults to single-file-edit (no task-shape floor) when omitted. */
	readonly taskType?: CodingTaskType;
}

export interface ModelFloorRecommendation {
	readonly languages: readonly LanguageTally[];
	/** The most-touched language, or "unknown" when no source file was recognised. */
	readonly dominantLanguage: ProgrammingLanguage;
	/** Highest per-language floor across ALL detected languages (a Rust file in a mostly-Python card still needs 32B). */
	readonly languageFloorB: number;
	readonly taskTypeFloorB: number;
	/** max(languageFloorB, taskTypeFloorB) — the minimum model size the router should require. */
	readonly recommendedFloorB: number;
	readonly reason: string;
}

/**
 * Recommend a minimum model size for a card. The floor is the MAX of (a) the strongest language requirement among all
 * touched source files — a single Rust file in an otherwise-Python card still pins the floor to 32B, since that file must be
 * edited correctly — and (b) the task-shape floor. Returns a floor the router can hand to the fitness prior; difficulty then
 * chooses within the qualifying models.
 */
export function recommendModelFloor(input: ModelFloorInput): ModelFloorRecommendation {
	const languages = detectLanguages(input.filePaths);
	const taskType = input.taskType ?? "single-file-edit";
	const dominantLanguage = languages[0]?.language ?? "unknown";

	const languageFloorB =
		languages.length === 0
			? LANGUAGE_FLOOR_B.unknown
			: Math.max(...languages.map((l) => LANGUAGE_FLOOR_B[l.language]));
	const taskTypeFloorB = TASK_TYPE_FLOOR_B[taskType];
	const recommendedFloorB = Math.max(languageFloorB, taskTypeFloorB);

	const driver =
		recommendedFloorB === 0
			? "no floor — a capable small model suffices"
			: taskTypeFloorB >= languageFloorB && taskTypeFloorB > 0
				? `${taskType} task shape (small-model tool-calling collapses after 2–3 steps)`
				: `${dominantLanguage} language capability floor`;
	const langLabel = languages.length === 0 ? "no source files detected" : languages.map((l) => l.language).join("+");
	const reason = `≥${recommendedFloorB}B: ${driver} [languages: ${langLabel}; task: ${taskType}].`;

	return { languages, dominantLanguage, languageFloorB, taskTypeFloorB, recommendedFloorB, reason };
}
