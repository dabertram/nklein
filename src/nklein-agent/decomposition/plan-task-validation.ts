import { assessNKleinPlanTaskGraphQuality } from "../nklein-decomposition-graph-quality";
import type { ValidateNKleinPlanTaskGraphResult } from "../nklein-decomposition-tool";
import type { NKleinPlanQuestion, NKleinPlanTask, NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import { nkleinPlanTaskGraphSchema } from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { buildTaskPrompt } from "./plan-task-prompt";
import { selectTaskRoutingCandidate } from "./plan-task-routing";
import { MAX_DECOMPOSED_TASK_COMPLEXITY, MAX_DECOMPOSED_TASK_LIKELY_FILES } from "./plan-task-schemas";

export function normalizeTaskAcceptanceCommand(
	task: NKleinPlanTask,
	defaultAcceptanceCommand: string | null,
): NKleinPlanTask {
	const normalizedDefaultAcceptanceCommand = defaultAcceptanceCommand?.trim() || null;
	const acceptanceTestPrompt = task.acceptanceTestPrompt?.trim() || null;
	return {
		...task,
		// Trim the id so it matches its dependents' (already-trimmed) `dependsOn` entries below — otherwise a padded id
		// (` build `, valid per `z.string().min(1)` which counts chars without trimming) never equals the trimmed edge
		// target, and `validateTaskGraphReferences` bogus-rejects a legitimate edge as "depends on unknown task".
		id: task.id.trim(),
		// FILL-ONLY (decided 2026-07-05, David): honor a task's OWN acceptanceCommand; the global `defaultAcceptanceCommand`
		// only fills in when the task omits one — matches the tool-schema contract ("applied to tasks that omit
		// acceptanceCommand"). A coarse global default must not silently clobber a card's own, more precise objective check.
		acceptanceCommand: task.acceptanceCommand?.trim() || normalizedDefaultAcceptanceCommand,
		testFirst: task.testFirst && acceptanceTestPrompt !== null,
		acceptanceTestPrompt,
		knowledgeDebt: task.knowledgeDebt?.trim() || null,
		dependsOn: uniqStringsInternal(task.dependsOn),
	};
}

// Internal helper: uniqStrings used by normalizeTaskAcceptanceCommand. The canonical export lives in plan-task-expansion.ts.
function uniqStringsInternal(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function validateTaskSizingContract(task: NKleinPlanTask): void {
	if (!task.acceptanceCommand?.trim()) {
		throw new Error(`Task ${task.id} is missing an acceptanceCommand; split or specify an objective check.`);
	}
	if (task.testFirst && !task.acceptanceTestPrompt?.trim()) {
		throw new Error(`Task ${task.id} is test-first but missing an acceptanceTestPrompt.`);
	}
	if (task.complexity > MAX_DECOMPOSED_TASK_COMPLEXITY) {
		throw new Error(
			`Task ${task.id} has complexity ${Math.round(task.complexity)}/100; split it below ${MAX_DECOMPOSED_TASK_COMPLEXITY}/100 before decomposing.`,
		);
	}
	if (task.filesLikelyTouched.length > MAX_DECOMPOSED_TASK_LIKELY_FILES) {
		throw new Error(
			`Task ${task.id} touches ${task.filesLikelyTouched.length} likely files; split it to ${MAX_DECOMPOSED_TASK_LIKELY_FILES} files or fewer before decomposing.`,
		);
	}
}

/**
 * Parse-and-recover for clarifying questions (AGENTS.md: recover in !Klein, don't teach the model). When the
 * model emits an `open` question that offers options but no working default, supply one automatically from its
 * `recommended` option (else the first option) instead of bouncing the model with "add an `assumption`". Weak
 * local models frequently cannot comply with that directive and just re-send the identical decompose call,
 * looping until the repeated-tool-call guard pauses the task. The question stays **open** (so the §5.S clarify
 * loop / the user can still resolve it) but now carries a default, so the plan proceeds. An OPEN question with no
 * options is left untouched — there is nothing safe to assume, so validation still guides. An `assumed-default`
 * question missing its assumption is ALSO recovered (live-found 2026-07-08: qwopus3.5's decompose call bounced on
 * exactly this and the session ended before a successful retry): the model already COMMITTED to assuming and only
 * omitted the text, so derive it from the options — or, with none, from the question itself.
 */
export function deriveOpenQuestionDefaults(questions: readonly NKleinPlanQuestion[]): NKleinPlanQuestion[] {
	return questions.map((question) => {
		if (
			(question.status !== "open" && question.status !== "assumed-default") ||
			question.assumption?.trim() ||
			question.answer?.trim()
		) {
			return question;
		}
		const chosen = question.options.find((option) => option.recommended) ?? question.options[0];
		if (chosen) {
			return {
				...question,
				assumption: `Proceeding with "${chosen.label}" as the default${chosen.recommended ? " (recommended option)" : ""}; revisit during clarification.`,
			};
		}
		if (question.status === "assumed-default") {
			return {
				...question,
				assumption: `Assuming the conventional default for: "${question.question}"; revisit during clarification.`,
			};
		}
		return question;
	});
}

export function validatePlanQuestions(questions: readonly NKleinPlanQuestion[]): void {
	for (const question of questions) {
		// An `open` clarifying question may proceed as long as it carries a working default — an `assumption` (a
		// sensible default to plan against) or an `answer`. It then stays *open* for later clarification (the
		// architect/reviewer auto-clarify loop, or the user; todo §5.S) instead of forcing the asking model to
		// fabricate an `assumed-default` just to get past validation (which both burns turns on weak models and
		// throws away the genuine question). Only reject an open question with no working default at all — planning
		// against a truly unresolved unknown is unsafe.
		if (question.status === "open" && !question.assumption?.trim() && !question.answer?.trim()) {
			throw new Error(
				`Clarifying question ${question.id} is open with no working default; add an \`assumption\` (a sensible default to plan against) so the plan can proceed while the question stays open for clarification — do not invent a hard answer.`,
			);
		}
		if (question.status === "answered" && !question.answer?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked answered but missing an answer.`);
		}
		if (question.status === "assumed-default" && !question.assumption?.trim()) {
			throw new Error(`Clarifying question ${question.id} is marked assumed-default but missing an assumption.`);
		}
	}
}

export function validateTaskGraphReferences(taskGraph: NKleinPlanTaskGraph): number {
	const taskIds = new Set<string>();
	let dependencyCount = 0;
	for (const task of taskGraph.tasks) {
		if (taskIds.has(task.id)) {
			throw new Error(`Task graph contains duplicate task id ${task.id}.`);
		}
		taskIds.add(task.id);
	}
	for (const task of taskGraph.tasks) {
		for (const dependencyPlanTaskId of task.dependsOn) {
			dependencyCount += 1;
			if (!taskIds.has(dependencyPlanTaskId)) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
		}
	}
	return dependencyCount;
}

export function validateNKleinPlanTaskGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	/**
	 * When true, graph-coherence violations (test/docs cards floating free of the work they verify/document)
	 * reject the graph. Defaults to false so applying an already-persisted graph or validating a partial
	 * replacement graph does not retroactively throw; the creation gate (`decompose_project`) opts in.
	 */
	enforceGraphQuality?: boolean;
}): ValidateNKleinPlanTaskGraphResult {
	const parsedTaskGraph = nkleinPlanTaskGraphSchema.parse(input.taskGraph);
	const taskGraph: NKleinPlanTaskGraph = {
		...parsedTaskGraph,
		tasks: parsedTaskGraph.tasks.map((task) => normalizeTaskAcceptanceCommand(task, null)),
	};
	for (const task of taskGraph.tasks) {
		validateTaskSizingContract(task);
		selectTaskRoutingCandidate(task, buildTaskPrompt(task), input.routingCandidates);
	}
	const dependencyCount = validateTaskGraphReferences(taskGraph);
	const quality = assessNKleinPlanTaskGraphQuality(taskGraph);
	if (input.enforceGraphQuality && quality.violations.length > 0) {
		throw new Error(
			`Task graph failed dependency-coherence validation:\n- ${quality.violations.join(
				"\n- ",
			)}\nAdd the missing dependency edges (or split/merge cards) and resubmit.`,
		);
	}
	return {
		taskGraph,
		taskCount: taskGraph.tasks.length,
		dependencyCount,
		quality,
	};
}
