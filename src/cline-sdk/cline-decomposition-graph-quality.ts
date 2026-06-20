import type { ClinePlanTask, ClinePlanTaskGraph } from "./cline-plan-artifacts";

/**
 * Decomposition graph-quality assessment.
 *
 * follow-up-6 §3.1/§3.3 (the audio VST / psytrance dev-test run) showed the decomposer happily emitting a
 * plausible-looking DAG that was operationally incoherent: 13 cards with only 3 dependency edges, several
 * apparently dependent tasks completing out of order, and test/docs/UI cards floating free of the work they
 * verify, document, or render. `validateClinePlanTaskGraph` already enforces the per-task *sizing* contract;
 * this module adds graph-level *coherence* checks on top of it.
 *
 * Design choice (deliberate, documented): the coverage/direction rules that are unambiguous and produce an
 * actionable repair instruction are **hard violations** (they reject the graph). Heuristic signals that are
 * useful but can legitimately fire on a valid graph — overall sparsity, isolated cards, possibly-reversed
 * edges — are **warnings** that the caller surfaces in the tool result and self-observation telemetry rather
 * than throwing. This keeps small/local models from getting stuck in a reject loop on a defensible graph
 * while still making the weak-graph signal visible (follow-up-6 §3.2, §3.4).
 */

export interface ClinePlanTaskGraphQualityAssessment {
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
	task: ClinePlanTask;
	isTest: boolean;
	isDocs: boolean;
	isUi: boolean;
	isDomainCore: boolean;
}

function taskText(task: ClinePlanTask): string {
	return `${task.title}\n${task.prompt}\n${task.filesLikelyTouched.join("\n")}`.toLowerCase();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

const TEST_PATTERNS: readonly RegExp[] = [
	/\btests?\b/,
	/\bspec(s)?\b/,
	/\bacceptance\b/,
	/\bverif(y|ication|ies)\b/,
	/\bcoverage\b/,
	/\.(test|spec)\.[a-z]+/,
	/(^|\/)tests?\//,
];

const DOCS_PATTERNS: readonly RegExp[] = [
	/\breadme\b/,
	/\bdocs?\b/,
	/\bdocumentation\b/,
	/\bchangelog\b/,
	/\busage notes?\b/,
];

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

function classifyTask(task: ClinePlanTask): ClassifiedTask {
	const text = taskText(task);
	const isTest = matchesAny(text, TEST_PATTERNS);
	const isDocs = matchesAny(text, DOCS_PATTERNS);
	// A test/docs card is not also treated as the implementation/domain work it depends on.
	const isUi = !isTest && !isDocs && matchesAny(text, UI_PATTERNS);
	const isDomainCore = !isTest && !isDocs && matchesAny(text, DOMAIN_CORE_PATTERNS);
	return { task, isTest, isDocs, isUi, isDomainCore };
}

export function assessClinePlanTaskGraphQuality(taskGraph: ClinePlanTaskGraph): ClinePlanTaskGraphQualityAssessment {
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
