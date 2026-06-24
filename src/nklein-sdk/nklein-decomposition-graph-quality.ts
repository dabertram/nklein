import type { NKleinPlanTask, NKleinPlanTaskGraph } from "./nklein-plan-artifacts";

/**
 * Decomposition graph-quality assessment.
 *
 * follow-up-6 §3.1/§3.3 (the audio VST / psytrance dev-test run) showed the decomposer happily emitting a
 * plausible-looking DAG that was operationally incoherent: 13 cards with only 3 dependency edges, several
 * apparently dependent tasks completing out of order, and test/docs/UI cards floating free of the work they
 * verify, document, or render. `validateNKleinPlanTaskGraph` already enforces the per-task *sizing* contract;
 * this module adds graph-level *coherence* checks on top of it.
 *
 * Design choice (deliberate, documented): the coverage/direction rules that are unambiguous and produce an
 * actionable repair instruction are **hard violations** (they reject the graph). Heuristic signals that are
 * useful but can legitimately fire on a valid graph — overall sparsity, isolated cards, possibly-reversed
 * edges — are **warnings** that the caller surfaces in the tool result and self-observation telemetry rather
 * than throwing. This keeps small/local models from getting stuck in a reject loop on a defensible graph
 * while still making the weak-graph signal visible (follow-up-6 §3.2, §3.4).
 */

export interface NKleinPlanTaskGraphQualityAssessment {
	/** Actionable, unambiguous problems that should reject the graph. */
	violations: string[];
	/** Heuristic concerns to surface but not reject on. */
	warnings: string[];
	taskCount: number;
	dependencyCount: number;
	/** dependencyCount / taskCount, the average in-degree of the graph. */
	dependencyDensity: number;
	/** Plan-task ids with no incoming or outgoing dependency edges. */
	isolatedTaskIds: string[];
}

/** Average in-degree below this for a non-trivial graph is treated as suspiciously sparse. */
const SPARSE_DEPENDENCY_DENSITY = 0.5;
/** Sparsity / isolation warnings only apply once a graph is large enough that no edges is implausible. */
const MIN_TASKS_FOR_DENSITY_WARNING = 5;

interface ClassifiedTask {
	task: NKleinPlanTask;
	isTest: boolean;
	isDocs: boolean;
	isUi: boolean;
	isDomainCore: boolean;
}

function taskText(task: NKleinPlanTask): string {
	return `${task.title}\n${task.prompt}\n${task.filesLikelyTouched.join("\n")}`.toLowerCase();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

/** Test-card signals in a card *title* (the card's declared intent). */
const TEST_PATTERNS: readonly RegExp[] = [
	/\btests?\b/,
	/\bspec(s)?\b/,
	/\bacceptance\b/,
	/\bverif(y|ication|ies)\b/,
	/\bcoverage\b/,
	/\bgolden\b/,
];

/** Likely-touched paths that are themselves test files (the file-level "this is a test card" signal). */
const TEST_FILE_PATTERNS: readonly RegExp[] = [/\.(test|spec)\.[a-z]+$/, /(^|\/)(tests?|__tests__|e2e)\//];

/** Docs-card signals in a card *title*. */
const DOCS_PATTERNS: readonly RegExp[] = [
	/\breadme\b/,
	/\bdocs?\b/,
	/\bdocumentation\b/,
	/\bchangelog\b/,
	/\busage notes?\b/,
];

/** Likely-touched paths that are themselves documentation files. */
const DOCS_FILE_PATTERNS: readonly RegExp[] = [/(^|\/)docs?\//, /\breadme\b/, /\.md$/];

/** True only when the card touches files and *every* one of them matches the given (file) patterns. */
function allFilesMatch(files: readonly string[], patterns: readonly RegExp[]): boolean {
	return files.length > 0 && files.every((file) => matchesAny(file.toLowerCase(), patterns));
}

const UI_PATTERNS: readonly RegExp[] = [/\bui\b/, /\buser interface\b/, /\bfrontend\b/, /\bgui\b/];

const DOMAIN_CORE_PATTERNS: readonly RegExp[] = [
	/\bdomain\b/,
	/\bcore\b/,
	/\bengine\b/,
	/\bsynth(esis)?\b/,
	/\brender(ing|er)?\b/,
	/\balgorithm\b/,
	/\bdsp\b/,
	/\bapi\b/,
	/\bschema\b/,
	/\bcontrols?\b/,
	/\bmetadata\b/,
	/\bstate\b/,
	/\bmodel\b/,
];

function classifyTask(task: NKleinPlanTask): ClassifiedTask {
	const text = taskText(task);
	const titleText = task.title.toLowerCase();
	// Classify *test* / *docs* cards by their identity — the title and the files they touch — NOT the prompt body.
	// Implementation prompts routinely say things like "keep the existing tests passing" or "ensure compatibility
	// with x.test.js", and a domain spec can repeat "tests must depend on implementation" across every card. Matching
	// those in the prompt body wrongly reclassified the *implementation* card as a test/docs card, producing an
	// impossible "test card must depend on an implementation card" violation that the decomposer then looped on
	// forever (evidence: the DAW-foundation dev run where "Implement TempoMap class … timebase.test.js" — touching
	// `src/timebase.ts` — was flagged as a test card). A card is a test/docs card only when its title declares that
	// intent, or when *every* file it touches is itself a test/docs file.
	const isTest = matchesAny(titleText, TEST_PATTERNS) || allFilesMatch(task.filesLikelyTouched, TEST_FILE_PATTERNS);
	const isDocs = matchesAny(titleText, DOCS_PATTERNS) || allFilesMatch(task.filesLikelyTouched, DOCS_FILE_PATTERNS);
	// A test/docs card is not also treated as the implementation/domain work it depends on.
	const isUi = !isTest && !isDocs && matchesAny(text, UI_PATTERNS);
	const isDomainCore = !isTest && !isDocs && matchesAny(text, DOMAIN_CORE_PATTERNS);
	return { task, isTest, isDocs, isUi, isDomainCore };
}

export function assessNKleinPlanTaskGraphQuality(taskGraph: NKleinPlanTaskGraph): NKleinPlanTaskGraphQualityAssessment {
	const tasks = taskGraph.tasks;
	const taskCount = tasks.length;
	const classified = tasks.map(classifyTask);
	const classifiedById = new Map(classified.map((entry) => [entry.task.id, entry]));

	const dependencyCount = tasks.reduce((total, task) => total + new Set(task.dependsOn).size, 0);
	const dependencyDensity = taskCount > 0 ? dependencyCount / taskCount : 0;

	const hasIncoming = new Set<string>();
	const hasOutgoing = new Set<string>();
	for (const task of tasks) {
		for (const dependencyId of new Set(task.dependsOn)) {
			if (!classifiedById.has(dependencyId)) {
				continue;
			}
			hasOutgoing.add(task.id);
			hasIncoming.add(dependencyId);
		}
	}
	const isolatedTaskIds = tasks
		.filter((task) => !hasIncoming.has(task.id) && !hasOutgoing.has(task.id))
		.map((task) => task.id);

	const violations: string[] = [];
	const warnings: string[] = [];

	const nonTestExists = classified.some((entry) => !entry.isTest);
	const nonDocsExists = classified.some((entry) => !entry.isDocs);
	const domainCoreExists = classified.some((entry) => entry.isDomainCore);

	for (const entry of classified) {
		const dependencies = [...new Set(entry.task.dependsOn)]
			.map((id) => classifiedById.get(id))
			.filter((dependency): dependency is ClassifiedTask => Boolean(dependency));

		// Hard: a test/acceptance card must verify something — it must depend on a non-test card.
		if (entry.isTest && nonTestExists && !dependencies.some((dependency) => !dependency.isTest)) {
			violations.push(
				`Test card ${entry.task.id} ("${entry.task.title}") does not depend on any implementation card; add a dependsOn edge to the card(s) it verifies.`,
			);
		}

		// Hard: a documentation card should document delivered work — it must depend on a non-docs card.
		if (entry.isDocs && nonDocsExists && !dependencies.some((dependency) => !dependency.isDocs)) {
			violations.push(
				`Documentation card ${entry.task.id} ("${entry.task.title}") does not depend on any feature/API card; add a dependsOn edge to the work it documents.`,
			);
		}

		// Soft: a UI card usually consumes domain/control metadata; warn if it ignores all of it.
		if (
			entry.isUi &&
			domainCoreExists &&
			!entry.isDomainCore &&
			!dependencies.some((dependency) => dependency.isDomainCore)
		) {
			warnings.push(
				`UI card ${entry.task.id} ("${entry.task.title}") does not depend on any domain/control card; confirm it does not need the core data/control metadata first.`,
			);
		}

		// Soft: a non-test implementation card depending on a test card is a likely reversed edge.
		const reversed = dependencies.filter((dependency) => dependency.isTest);
		if (!entry.isTest && reversed.length > 0) {
			warnings.push(
				`Card ${entry.task.id} ("${entry.task.title}") depends on test card(s) ${reversed
					.map((dependency) => dependency.task.id)
					.join(
						", ",
					)}; this edge is likely reversed (tests should depend on implementation, not the other way around).`,
			);
		}
	}

	if (taskCount >= MIN_TASKS_FOR_DENSITY_WARNING && dependencyDensity < SPARSE_DEPENDENCY_DENSITY) {
		warnings.push(
			`Graph is sparse for its size: ${dependencyCount} dependency edge(s) across ${taskCount} cards (density ${dependencyDensity.toFixed(
				2,
			)}). Confirm the cards are genuinely independent rather than missing ordering edges.`,
		);
	}
	if (taskCount >= MIN_TASKS_FOR_DENSITY_WARNING && isolatedTaskIds.length > 0) {
		warnings.push(
			`Cards with no dependency edges in either direction: ${isolatedTaskIds.join(
				", ",
			)}. Confirm they are truly standalone.`,
		);
	}

	return {
		violations,
		warnings,
		taskCount,
		dependencyCount,
		dependencyDensity,
		isolatedTaskIds,
	};
}
