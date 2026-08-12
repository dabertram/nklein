import { z } from "zod";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeStream,
} from "../../core/api-contract";
import { withAutonomousNKleinTimeoutSettings } from "../../core/autonomous-timeout-defaults";
import { buildIntegrationParentPrompt, INTEGRATION_PARENT_PROMPT_MARKER } from "../../core/review-redecompose";
import { addTaskDependency, addTaskToColumn, moveTaskToColumn } from "../../core/task-board-mutations";
import type {
	ApplyNKleinPlanTaskGraphInput,
	ApplyNKleinPlanTaskGraphResult,
	ReplaceNKleinPlanTaskInGraphResult,
} from "../nklein-decomposition-tool";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import { nkleinPlanTaskGraphSchema, nkleinPlanTaskSchema } from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import {
	assertFleetReshardSubmissionSafe,
	fingerprintFleetRoutingCandidates,
	snapshotFleetRoutingCandidates,
} from "./fleet-change-reshard";
import { breakDependencyCycles } from "./plan-task-cycle-break";
import { expandDecomposeProjectTasks, getReplacementBoundaryTaskIds } from "./plan-task-expansion";
import { shouldAttachPlanTaskFocusedSpan } from "./plan-task-focused-spans";
import { slugifyTaskId } from "./plan-task-input-parse";
import { buildTaskPrompt } from "./plan-task-prompt";
import {
	derivePlanTaskRoutingSizing,
	formatTaskModelFitEvidence,
	previewNKleinPlanTaskGraph,
	resolveTaskModelSettings,
	selectTaskRoutingCandidate,
} from "./plan-task-routing";
import { validateNKleinPlanTaskGraph } from "./plan-task-validation";

/** §5.AU: the deterministic stream id for a decomposition slug — matches `deriveStreams` (`stream-<slug>`). */
function decompositionStreamId(planSlug: string): string {
	return `stream-${planSlug}`;
}

/** Humanize a plan slug into a stream title fallback (used when the source card's title is unavailable). */
function streamTitleFromSlug(planSlug: string): string {
	const words = planSlug.replace(/[-_]+/g, " ").trim();
	return words.length > 0 ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : planSlug;
}

export function collectBoardTaskIds(board: RuntimeBoardData): Set<string> {
	return new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
}

export function findGeneratedPlanTaskCard(input: {
	board: RuntimeBoardData;
	planSlug: string;
	planTaskId: string;
}): RuntimeBoardCard | null {
	for (const column of input.board.columns) {
		for (const card of column.cards) {
			if (
				card.generatedFromPlan?.planSlug === input.planSlug &&
				card.generatedFromPlan.planTaskId === input.planTaskId
			) {
				return card;
			}
		}
	}
	return null;
}

export function replaceNKleinPlanTaskInGraph(input: {
	taskGraph: NKleinPlanTaskGraph;
	taskId: string;
	replacements: readonly NKleinPlanTask[];
	defaultAcceptanceCommand?: string | null;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
}): ReplaceNKleinPlanTaskInGraphResult {
	const taskGraph = nkleinPlanTaskGraphSchema.parse(input.taskGraph);
	const taskId = input.taskId.trim();
	if (!taskId) {
		throw new Error("Replacement target task id is required.");
	}
	if (!taskGraph.tasks.some((task) => task.id === taskId)) {
		throw new Error(`Task graph does not contain task ${taskId}.`);
	}
	const replacements = z.array(nkleinPlanTaskSchema).parse(input.replacements);
	if (replacements.length === 0) {
		throw new Error(`Replacement for task ${taskId} must include at least one task.`);
	}
	const replacementBoundary = getReplacementBoundaryTaskIds(replacements);
	const nextTaskGraph: NKleinPlanTaskGraph = {
		...taskGraph,
		tasks: expandDecomposeProjectTasks({
			tasks: taskGraph.tasks,
			expansions: {
				[taskId]: replacements,
			},
			defaultAcceptanceCommand: input.defaultAcceptanceCommand?.trim() || null,
		}),
	};
	validateNKleinPlanTaskGraph({
		taskGraph: nextTaskGraph,
		routingCandidates: input.routingCandidates,
	});
	return {
		taskGraph: nextTaskGraph,
		...replacementBoundary,
	};
}

export function applyNKleinPlanTaskGraphToBoard(input: ApplyNKleinPlanTaskGraphInput): ApplyNKleinPlanTaskGraphResult {
	let board = input.board;
	const validatedTaskGraph = validateNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		routingCandidates: input.routingCandidates,
	}).taskGraph;
	// Guarantee an acyclic, startable graph. An architect model can emit a cyclic/over-constrained dependency graph
	// (every card depends on something) that would materialize a board with NO dependency-free root — so `rootTaskIds`
	// below is empty and the auto-start cascade never begins (live-found 2026-07-02 on `complex_dag`). Break the minimal
	// back-edges so the cascade can start; the runtime reorients a card's edges on start, so completing the entry card
	// unblocks the rest. Acyclic graphs pass through untouched (no broken edges, same task references).
	const cycleBreak = breakDependencyCycles(validatedTaskGraph.tasks);
	const taskGraph =
		cycleBreak.brokenEdges.length > 0 ? { ...validatedTaskGraph, tasks: cycleBreak.tasks } : validatedTaskGraph;
	const createdTasks: RuntimeBoardCard[] = [];
	const createdDependencies: RuntimeBoardDependency[] = [];
	const taskIdByPlanTaskId: Record<string, string> = {};
	const usedBoardTaskIds = collectBoardTaskIds(board);
	const now = input.now ?? Date.now();
	const preview = previewNKleinPlanTaskGraph({
		taskGraph,
		routingCandidates: input.routingCandidates,
		sharedContext: input.sharedContext,
	});
	const fleetCandidates =
		input.fleetDecompositionSettings?.mode !== "off"
			? snapshotFleetRoutingCandidates(input.fleetSizingCandidates ?? input.routingCandidates ?? [])
			: [];
	const fleetFingerprint = fingerprintFleetRoutingCandidates(fleetCandidates);
	// §5.AB re-decompose rung: the source card's typed stamps, resolved from the ORIGINAL board (immutable through
	// the mutations below) — children inherit its decompose generation; `redecomposeOf` names the parked parent to
	// convert into an integration card once the children exist.
	const sourceCard = input.sourceTaskId
		? (input.board.columns.flatMap((column) => column.cards).find((card) => card.id === input.sourceTaskId) ?? null)
		: null;
	const reshardRequest = assertFleetReshardSubmissionSafe(board, input.sourceTaskId, taskGraph);
	if (reshardRequest) {
		for (const planTaskId of reshardRequest.targetPlanTaskIds) {
			const located = board.columns
				.map((column) => ({
					columnId: column.id,
					card: column.cards.find(
						(card) =>
							card.generatedFromPlan?.planSlug === taskGraph.slug &&
							card.generatedFromPlan.planTaskId === planTaskId,
					),
				}))
				.find((entry) => entry.card !== undefined);
			if (!located?.card) continue; // asserted above; defensive against malformed duplicate provenance
			board = moveTaskToColumn(board, located.card.id, "trash", now).board;
		}
	}

	// Duplicate-decomposition guard (live-found 2026-07-18): one seed card applied TWO differently-slugged
	// decompositions — a retry re-ran the whole plan under a fresh slug and materialized parallel duplicate
	// chains competing for the same spec. A source card that already generated cards under ANOTHER slug must
	// amend that plan (same slug = the existing idempotent re-apply) or go through an explicit redecompose card
	// (its own source id) — never silently fork a second plan.
	if (input.sourceTaskId) {
		const existingSlug = board.columns
			.filter((column) => column.id !== "trash")
			.flatMap((column) => column.cards)
			.find(
				(card) =>
					card.generatedFromPlan?.sourceTaskId === input.sourceTaskId &&
					card.generatedFromPlan?.planSlug !== taskGraph.slug,
			)?.generatedFromPlan?.planSlug;
		if (existingSlug) {
			throw new Error(
				`This card already decomposed as plan "${existingSlug}" — resubmit under that slug to amend the existing plan instead of forking a second one ("${taskGraph.slug}").`,
			);
		}
	}

	// §5.AU: materialize the decomposition's STREAM (epic) once, idempotently, and stamp every generated card with its
	// streamId below. Title from the source card when known, else the humanized slug. Additive: older boards had no
	// `streams`, so this seeds it; a re-apply finds the existing stream and does not duplicate it.
	const streamId = decompositionStreamId(taskGraph.slug);
	if (!(board.streams ?? []).some((stream) => stream.id === streamId)) {
		const sourceCardTitle = input.sourceTaskId
			? board.columns.flatMap((column) => column.cards).find((card) => card.id === input.sourceTaskId)?.title
			: undefined;
		const stream: RuntimeStream = {
			id: streamId,
			title: sourceCardTitle?.trim() || streamTitleFromSlug(taskGraph.slug),
			source: "decomposition",
			planSlug: taskGraph.slug,
			createdAt: now,
			updatedAt: now,
		};
		board = { ...board, streams: [...(board.streams ?? []), stream] };
	}

	for (const task of taskGraph.tasks) {
		const existingGeneratedCard = findGeneratedPlanTaskCard({
			board,
			planSlug: taskGraph.slug,
			planTaskId: task.id,
		});
		if (existingGeneratedCard) {
			usedBoardTaskIds.add(existingGeneratedCard.id);
			taskIdByPlanTaskId[task.id] = existingGeneratedCard.id;
			continue;
		}
		const availableFocusedCodeSpan = input.focusedSpansByTaskId?.[task.id];
		const taskPromptForRouting = buildTaskPrompt(task, input.sharedContext);
		const routingSizing = derivePlanTaskRoutingSizing(
			task,
			taskPromptForRouting,
			input.fleetSizingCandidates ?? input.routingCandidates,
		);
		const selectedRoutingCandidate = selectTaskRoutingCandidate(task, taskPromptForRouting, input.routingCandidates);
		const focusedCodeSpan = shouldAttachPlanTaskFocusedSpan(selectedRoutingCandidate)
			? availableFocusedCodeSpan
			: undefined;
		const taskPrompt = buildTaskPrompt(
			task,
			input.sharedContext,
			formatTaskModelFitEvidence(selectedRoutingCandidate),
			focusedCodeSpan,
		);
		const selectedRole =
			selectedRoutingCandidate === undefined ? undefined : (selectedRoutingCandidate?.role ?? null);
		const baseTaskId = `${slugifyTaskId(taskGraph.slug)}-${slugifyTaskId(task.id)}`;
		let taskId = baseTaskId;
		for (let suffix = 2; usedBoardTaskIds.has(taskId); suffix += 1) {
			taskId = `${baseTaskId}-${suffix}`;
		}
		usedBoardTaskIds.add(taskId);
		const created = addTaskToColumn(
			board,
			"planning",
			{
				taskId,
				title: task.title,
				prompt: taskPrompt,
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "nklein",
				baseRef: input.baseRef,
				nkleinSettings: withAutonomousNKleinTimeoutSettings(
					resolveTaskModelSettings(selectedRoutingCandidate, task, input.modelRoleSettings, selectedRole),
					{ powerMultiplier: input.powerMultiplier },
				),
				filesLikelyTouched: task.filesLikelyTouched,
				// F1.9: the card carries its work-package bounds so dispatch/review enforce without re-reading artifacts.
				...(task.writeScope ? { writeScope: [...task.writeScope] } : {}),
				...(task.forbiddenPaths ? { forbiddenPaths: [...task.forbiddenPaths] } : {}),
				// F1.34b-ext: the upfront testability declaration rides the card so the test-driven gate can honor it.
				...(task.testability ? { testability: task.testability } : {}),
				...(task.testability === "not_testable" && task.testabilityReason
					? { testabilityReason: task.testabilityReason }
					: {}),
				// Children of a re-decompose carry the redecompose card's generation, so the rung's depth guard
				// can count how many review-driven splits already sit above any card that later parks itself.
				...(sourceCard?.decomposeGeneration !== undefined
					? { decomposeGeneration: sourceCard.decomposeGeneration }
					: {}),
				generatedFromPlan: {
					artifactKind: "decomposition",
					planSlug: taskGraph.slug,
					planTaskId: task.id,
					sourceTaskId: input.sourceTaskId ?? null,
					...(fleetCandidates.length > 0 && fleetFingerprint
						? {
								fleetSizing: {
									fingerprint: fleetFingerprint,
									candidates: fleetCandidates,
									...routingSizing,
									autoReshardOnFleetChange: input.fleetDecompositionSettings?.autoReshardOnFleetChange ?? true,
								},
							}
						: {}),
				},
				streamId,
			},
			input.randomUuid,
			now,
		);
		board = created.board;
		createdTasks.push(created.task);
		taskIdByPlanTaskId[task.id] = created.task.id;
	}

	for (const task of taskGraph.tasks) {
		const waitingTaskId = taskIdByPlanTaskId[task.id];
		if (!waitingTaskId) {
			continue;
		}
		for (const dependencyPlanTaskId of task.dependsOn) {
			const prerequisiteTaskId = taskIdByPlanTaskId[dependencyPlanTaskId];
			if (!prerequisiteTaskId) {
				throw new Error(`Task ${task.id} depends on unknown task ${dependencyPlanTaskId}.`);
			}
			const linked = addTaskDependency(board, waitingTaskId, prerequisiteTaskId);
			if (!linked.added || !linked.dependency) {
				// Idempotent re-apply: on a re-apply the endpoints can legitimately have advanced past the waiting
				// lanes — a prerequisite that reached `completed`/`trash` (reason `trash_task`) or a card now in
				// `in_progress`/`review` (reason `non_backlog`) can no longer carry a board edge, and the edge is
				// either already satisfied or no longer expressible. Skip those benignly (as with an existing
				// `duplicate`). Only `missing_task`/`same_task` remain fatal — neither can occur for a validated,
				// freshly-mapped graph, so they signal genuine corruption. (These non-duplicate reasons never arise
				// on a clean first apply, where every generated card sits in the `planning` waiting lane.)
				if (linked.reason === "duplicate" || linked.reason === "trash_task" || linked.reason === "non_backlog") {
					continue;
				}
				throw new Error(`Could not link ${task.id} to ${dependencyPlanTaskId}: ${linked.reason ?? "unknown"}.`);
			}
			board = linked.board;
			createdDependencies.push(linked.dependency);
		}
	}

	const sourceTaskId = input.sourceTaskId?.trim() || null;
	// Complete the source PLANNING card only when its work actually materialized into cards. `taskIdByPlanTaskId` is
	// empty iff the task graph was empty — completing the source then would silently DISCARD the planning card with
	// zero cards created (work lost, no error). An empty graph is a model/upstream error, not a done decomposition:
	// leave the source card in place so it can be re-decomposed or inspected.
	const producedCards = Object.keys(taskIdByPlanTaskId).length > 0;

	// §5.AB re-decompose rung (David 2026-08-12): the parked PARENT the source card was spawned for becomes an
	// INTEGRATION card gated on the children — moved back into the waiting lane with a dependency edge on every
	// created card and its objective rewritten around the preserved original. Without this, the parent stays
	// parked forever and every downstream dependent stays dammed behind it even after the children deliver; and
	// completing it instead would LIE (releasing dependents before the split work exists). Terminal parents
	// (operator already merged/trashed) are left alone. Idempotent: a re-apply re-ensures edges (duplicate-benign)
	// but never re-wraps the prompt.
	const integrationParentTaskId = sourceCard?.redecomposeOf?.trim() || null;
	let integrationParentConverted = false;
	if (integrationParentTaskId && producedCards) {
		const parentLocation = board.columns
			.map((column) => ({
				columnId: column.id,
				card: column.cards.find((candidate) => candidate.id === integrationParentTaskId),
			}))
			.find((entry) => entry.card !== undefined);
		if (parentLocation?.card && parentLocation.columnId !== "completed" && parentLocation.columnId !== "trash") {
			const parent = parentLocation.card;
			const alreadyConverted = parent.prompt.startsWith(INTEGRATION_PARENT_PROMPT_MARKER);
			if (!alreadyConverted) {
				board = {
					...board,
					columns: board.columns.map((column) => ({
						...column,
						cards: column.cards.map((card) =>
							card.id === integrationParentTaskId
								? {
										...card,
										prompt: buildIntegrationParentPrompt({
											originalObjective: card.prompt,
											childTitles: createdTasks.map((task) => task.title ?? task.id),
										}),
										// The card is no longer waiting for a human — it waits for its children.
										...(card.review
											? {
													review: {
														...card.review,
														status: "changes_requested" as const,
														parkedReason: null,
														updatedAt: now,
													},
												}
											: {}),
										updatedAt: now,
									}
								: card,
						),
					})),
				};
				board = moveTaskToColumn(board, integrationParentTaskId, "planning", now).board;
				integrationParentConverted = true;
			}
			for (const created of createdTasks) {
				const linked = addTaskDependency(board, integrationParentTaskId, created.id);
				if (!linked.added || !linked.dependency) {
					// Duplicate on a re-apply is expected; a child that already advanced past the waiting lanes can
					// no longer carry an edge (the work it gates is underway/done) — both are benign here.
					continue;
				}
				board = linked.board;
				createdDependencies.push(linked.dependency);
			}
		}
	}
	if (sourceTaskId && producedCards && !Object.values(taskIdByPlanTaskId).includes(sourceTaskId)) {
		// F1.34c (live-found by the 20-set drain audit 2026-07-25): a decomposition SOURCE delivers a PLAN — specs,
		// scaffolding, spawned children — and the children carry the tests. Stamp it not_testable so a session-end
		// review racing this apply cannot bounce the seed on the test-driven gate into an identical-feedback park
		// (which froze every child behind it in Planning). The stamp is the F1.34b mechanism itself: an upfront
		// declaration by the layer that KNOWS the deliverable's nature — never worker-set.
		board = {
			...board,
			columns: board.columns.map((column) => ({
				...column,
				cards: column.cards.map((card) =>
					card.id === sourceTaskId && card.testability === undefined
						? {
								...card,
								testability: "not_testable" as const,
								testabilityReason:
									"decomposition source — delivers a plan; the generated cards carry the tests",
								updatedAt: now,
							}
						: card,
				),
			})),
		};
		board = moveTaskToColumn(board, sourceTaskId, "completed", now).board;
	}

	const rootTaskIds = taskGraph.tasks
		.filter((task) => task.dependsOn.length === 0)
		.map((task) => taskIdByPlanTaskId[task.id])
		.filter((taskId): taskId is string => Boolean(taskId));

	return {
		board,
		createdTasks,
		createdDependencies,
		taskIdByPlanTaskId,
		rootTaskIds,
		preview,
		...(cycleBreak.brokenEdges.length > 0 ? { brokenDependencyEdges: cycleBreak.brokenEdges } : {}),
		...(cycleBreak.condensedGroups.length > 0 ? { condensedCycleGroups: cycleBreak.condensedGroups } : {}),
		...(integrationParentConverted && integrationParentTaskId ? { integrationParentTaskId } : {}),
	};
}
