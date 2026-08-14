import type { RuntimeBoardCard, RuntimeBoardData, RuntimeFleetSizingCandidate } from "../../core/api-contract";
import { addTaskToColumn } from "../../core/task-board-mutations";
import type { NKleinPlanTaskGraph } from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { routeNKleinTask } from "../nklein-task-router";
import { slugifyTaskId } from "./plan-task-input-parse";

const WAITING_LANES = new Set(["backlog", "planning", "ready"]);

export interface StableFleetObservation {
	fingerprint: string;
	count: number;
}

export function advanceStableFleetObservation(
	prior: StableFleetObservation | null | undefined,
	fingerprint: string,
	requiredCount = 2,
): { observation: StableFleetObservation | null; stable: boolean } {
	if (!fingerprint.trim()) return { observation: null, stable: false };
	const observation = {
		fingerprint,
		count: prior?.fingerprint === fingerprint ? prior.count + 1 : 1,
	};
	return { observation, stable: observation.count >= Math.max(2, Math.trunc(requiredCount)) };
}

export function assertFleetReshardSubmissionSafe(
	board: RuntimeBoardData,
	sourceTaskId: string | null | undefined,
	taskGraph: NKleinPlanTaskGraph,
): RuntimeBoardCard["fleetReshardRequest"] | null {
	const source = sourceTaskId
		? board.columns.flatMap((column) => column.cards).find((card) => card.id === sourceTaskId)
		: undefined;
	const request = source?.fleetReshardRequest;
	if (!request) return null;
	if (request.planSlug !== taskGraph.slug) {
		throw new Error(
			`Fleet re-shard must amend the existing plan "${request.planSlug}"; received "${taskGraph.slug}".`,
		);
	}
	const targetsStillPresent = request.targetPlanTaskIds.filter((planTaskId) =>
		taskGraph.tasks.some((task) => task.id === planTaskId),
	);
	if (targetsStillPresent.length > 0) {
		throw new Error(
			`Fleet re-shard did not replace target plan task(s): ${targetsStillPresent.join(", ")}. Submit the complete existing graph with expansions for every target.`,
		);
	}
	for (const planTaskId of request.targetPlanTaskIds) {
		const located = board.columns.find((column) =>
			column.cards.some(
				(card) =>
					card.generatedFromPlan?.planSlug === taskGraph.slug && card.generatedFromPlan.planTaskId === planTaskId,
			),
		);
		if (!located || !WAITING_LANES.has(located.id)) {
			throw new Error(
				`Fleet re-shard target ${planTaskId} is no longer a waiting card; refusing to disrupt work that started or changed state.`,
			);
		}
	}
	return request;
}

/** Prove that a re-shard candidate is a surgical replacement, not a whole-plan rewrite. */
export function assertFleetReshardGraphAmendment(
	current: NKleinPlanTaskGraph,
	next: NKleinPlanTaskGraph,
	targetPlanTaskIds: readonly string[],
): void {
	if (current.slug !== next.slug || current.title !== next.title) {
		throw new Error("Fleet re-shard must preserve the existing plan slug and title.");
	}
	const targets = new Set(targetPlanTaskIds);
	const currentById = new Map(current.tasks.map((task) => [task.id, task]));
	const nextById = new Map(next.tasks.map((task) => [task.id, task]));
	const nonTargetIds = new Set(current.tasks.filter((task) => !targets.has(task.id)).map((task) => task.id));
	const replacementIds = new Set(next.tasks.filter((task) => !nonTargetIds.has(task.id)).map((task) => task.id));
	if (replacementIds.size === 0) throw new Error("Fleet re-shard must add replacement leaves for the target tasks.");

	for (const currentTask of current.tasks) {
		if (targets.has(currentTask.id)) continue;
		const nextTask = nextById.get(currentTask.id);
		if (!nextTask) throw new Error(`Fleet re-shard removed unaffected plan task ${currentTask.id}.`);
		const { dependsOn: currentDependsOn, ...currentShape } = currentTask;
		const { dependsOn: nextDependsOn, ...nextShape } = nextTask;
		if (JSON.stringify(currentShape) !== JSON.stringify(nextShape)) {
			throw new Error(`Fleet re-shard changed unaffected plan task ${currentTask.id}.`);
		}
		const preservedDependencies = currentDependsOn.filter((id) => !targets.has(id)).sort();
		const nextPreservedDependencies = nextDependsOn.filter((id) => nonTargetIds.has(id)).sort();
		if (JSON.stringify(preservedDependencies) !== JSON.stringify(nextPreservedDependencies)) {
			throw new Error(`Fleet re-shard changed unrelated dependencies of ${currentTask.id}.`);
		}
		if (currentDependsOn.some((id) => targets.has(id)) && !nextDependsOn.some((id) => replacementIds.has(id))) {
			throw new Error(`Fleet re-shard did not reconnect dependent task ${currentTask.id} to a replacement leaf.`);
		}
	}

	const externalPrerequisites = new Set(
		current.tasks
			.filter((task) => targets.has(task.id))
			.flatMap((task) => task.dependsOn)
			.filter((id) => !targets.has(id)),
	);
	for (const prerequisiteId of externalPrerequisites) {
		if (
			![...replacementIds].some((replacementId) => nextById.get(replacementId)?.dependsOn.includes(prerequisiteId))
		) {
			throw new Error(`Fleet re-shard did not connect replacement entry tasks to prerequisite ${prerequisiteId}.`);
		}
	}
	for (const target of targets) {
		if (!currentById.has(target)) throw new Error(`Fleet re-shard target ${target} is absent from the current plan.`);
	}
}

export function snapshotFleetRoutingCandidates(
	candidates: readonly NKleinTaskRoutingCandidate[],
): RuntimeFleetSizingCandidate[] {
	const byKey = new Map<string, RuntimeFleetSizingCandidate>();
	for (const candidate of candidates) {
		if (byKey.has(candidate.entry.key)) continue;
		byKey.set(candidate.entry.key, {
			modelKey: candidate.entry.key,
			providerId: candidate.entry.providerId,
			modelId: candidate.entry.modelId,
			capability: Math.max(
				0,
				Math.min(100, candidate.observedCapability ?? candidate.entry.capability.effectiveScore),
			),
			contextWindow: Math.max(0, Math.trunc(candidate.entry.contextWindow.effective ?? 0)),
		});
	}
	return [...byKey.values()].sort((left, right) => left.modelKey.localeCompare(right.modelKey));
}

/** Identity-only fingerprint: learned capability/speed updates do not masquerade as a loaded-fleet transition. */
export function fingerprintFleetRoutingCandidates(candidates: readonly RuntimeFleetSizingCandidate[]): string {
	return candidates
		.map((candidate) => candidate.modelKey.trim())
		.filter(Boolean)
		.sort((left, right) => left.localeCompare(right))
		.join("|");
}

export interface FleetChangeRebind {
	taskId: string;
	candidate: RuntimeFleetSizingCandidate;
}

export interface FleetChangeStrandedGroup {
	planSlug: string;
	taskIds: string[];
	planTaskIds: string[];
	fromFleetFingerprints: string[];
}

export interface FleetChangeReshardPlan {
	fingerprint: string;
	candidates: RuntimeFleetSizingCandidate[];
	rebinds: FleetChangeRebind[];
	strandedGroups: FleetChangeStrandedGroup[];
}

/**
 * Compare fleet-sized waiting cards with a stable loaded snapshot. A fitting replacement is rebound in place; only
 * cards no loaded model can clear are returned for re-sharding. Running/review cards are invisible to this decision.
 */
export function planFleetChangeReshard(input: {
	board: RuntimeBoardData;
	currentCandidates: readonly NKleinTaskRoutingCandidate[];
	activeTaskIds?: ReadonlySet<string>;
	enabled: boolean;
}): FleetChangeReshardPlan {
	const candidates = snapshotFleetRoutingCandidates(input.currentCandidates);
	const fingerprint = fingerprintFleetRoutingCandidates(candidates);
	const result: FleetChangeReshardPlan = { fingerprint, candidates, rebinds: [], strandedGroups: [] };
	if (!input.enabled || candidates.length === 0 || !fingerprint) return result;

	const existingRequests = new Map<string, Set<string>>();
	for (const column of input.board.columns) {
		for (const card of column.cards) {
			const request = card.fleetReshardRequest;
			if (!request) continue;
			const targets = existingRequests.get(request.planSlug) ?? new Set<string>();
			for (const planTaskId of request.targetPlanTaskIds) targets.add(planTaskId);
			existingRequests.set(request.planSlug, targets);
		}
	}

	const groups = new Map<string, FleetChangeStrandedGroup>();
	for (const column of input.board.columns) {
		if (!WAITING_LANES.has(column.id)) continue;
		for (const card of column.cards) {
			if (input.activeTaskIds?.has(card.id)) continue;
			const origin = card.generatedFromPlan;
			const sizing = origin?.fleetSizing;
			if (!origin || !sizing?.autoReshardOnFleetChange || sizing.fingerprint === fingerprint) continue;
			if (existingRequests.get(origin.planSlug)?.has(origin.planTaskId)) continue;
			const decision = routeNKleinTask({
				difficulty: sizing.taskDifficulty,
				fitBudgetTokens: sizing.fitBudgetTokens,
				promptTokens: sizing.promptTokens,
				outputTokens: 1_000,
				candidates: input.currentCandidates,
			});
			if (decision.type === "assign" || decision.type === "route_up") {
				const candidate = candidates.find((entry) => entry.modelKey === decision.modelKey);
				if (candidate) result.rebinds.push({ taskId: card.id, candidate });
				continue;
			}
			const group = groups.get(origin.planSlug) ?? {
				planSlug: origin.planSlug,
				taskIds: [],
				planTaskIds: [],
				fromFleetFingerprints: [],
			};
			group.taskIds.push(card.id);
			group.planTaskIds.push(origin.planTaskId);
			if (!group.fromFleetFingerprints.includes(sizing.fingerprint)) {
				group.fromFleetFingerprints.push(sizing.fingerprint);
			}
			groups.set(origin.planSlug, group);
		}
	}
	result.strandedGroups = [...groups.values()];
	return result;
}

function shortFingerprint(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	}
	return (hash >>> 0).toString(36).slice(0, 8);
}

function updateCardForFleet(
	card: RuntimeBoardCard,
	plan: FleetChangeReshardPlan,
	candidate: RuntimeFleetSizingCandidate,
	now: number,
): RuntimeBoardCard {
	const origin = card.generatedFromPlan;
	if (!origin?.fleetSizing) return card;
	return {
		...card,
		nkleinSettings: {
			...(card.nkleinSettings ?? {}),
			providerId: candidate.providerId,
			modelId: candidate.modelId,
		},
		generatedFromPlan: {
			...origin,
			fleetSizing: {
				...origin.fleetSizing,
				fingerprint: plan.fingerprint,
				candidates: plan.candidates,
			},
		},
		updatedAt: now,
	};
}

export function applyFleetChangeReshardPlan(input: {
	board: RuntimeBoardData;
	plan: FleetChangeReshardPlan;
	now?: number;
	createId?: () => string;
}): { board: RuntimeBoardData; spawnedTaskIds: string[]; blockedTaskIds: string[]; reboundTaskIds: string[] } {
	const now = input.now ?? Date.now();
	const rebindByTaskId = new Map(input.plan.rebinds.map((entry) => [entry.taskId, entry.candidate]));
	const strandedTaskIds = new Set(input.plan.strandedGroups.flatMap((group) => group.taskIds));
	let board: RuntimeBoardData = {
		...input.board,
		columns: input.board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => {
				const rebound = rebindByTaskId.get(card.id);
				if (rebound) return updateCardForFleet(card, input.plan, rebound, now);
				if (!strandedTaskIds.has(card.id)) return card;
				return {
					...card,
					blockedKind: "needs_decomposition" as const,
					blockedReason:
						"The stable loaded fleet changed and no currently loaded model can clear this card. !Klein is re-sharding only the stranded plan nodes.",
					// Auto-clear stamp (David 2026-08-12): released when the fleet changes AGAIN (re-evaluate by
					// unblocking; a still-unfit card is re-stamped by this same pass).
					blockedFleetFingerprint: input.plan.fingerprint,
					updatedAt: now,
				};
			}),
		})),
	};
	const spawnedTaskIds: string[] = [];
	for (const group of input.plan.strandedGroups) {
		const targetList = group.planTaskIds.join(", ");
		const requestIdentity = `${input.plan.fingerprint}|${[...group.planTaskIds].sort().join("|")}`;
		const taskId = `fleet-reshard-${slugifyTaskId(group.planSlug)}-${shortFingerprint(requestIdentity)}`;
		if (board.columns.some((column) => column.cards.some((card) => card.id === taskId))) continue;
		const firstTarget = board.columns
			.flatMap((column) => column.cards)
			.find((card) => group.taskIds.includes(card.id));
		if (!firstTarget) continue;
		const created = addTaskToColumn(
			board,
			"backlog",
			{
				taskId,
				title: `Re-shard stranded cards in ${group.planSlug}`,
				prompt: [
					`The stable LOADED model fleet changed after plan "${group.planSlug}" was sized, and these existing plan tasks are no longer clearable: ${targetList}.`,
					`Read the existing artifacts under .nklein/nklein/plans/${group.planSlug}/. Preserve the plan title, specification, plan text, and every NON-TARGET task and unrelated dependency. Use decompose_project with the EXACT SAME slug "${group.planSlug}", the complete current task list, and expansions that replace ONLY the target task IDs above with smaller independently verifiable leaves that the currently loaded fleet can clear. Do not implement the work directly and do not invent a new plan slug.`,
					"Keep tight write scopes and objective acceptance commands. The board apply gate will reject this amendment if any target remains or if a target started running meanwhile.",
				].join("\n\n"),
				baseRef: firstTarget.baseRef,
				startInPlanMode: true,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "nklein",
				fleetReshardRequest: {
					planSlug: group.planSlug,
					targetPlanTaskIds: [...group.planTaskIds],
					fromFleetFingerprints: [...group.fromFleetFingerprints],
					toFleetFingerprint: input.plan.fingerprint,
					requestedAt: now,
				},
			},
			input.createId ?? (() => globalThis.crypto.randomUUID()),
			now,
		);
		board = created.board;
		spawnedTaskIds.push(created.task.id);
	}
	return {
		board,
		spawnedTaskIds,
		blockedTaskIds: [...strandedTaskIds],
		reboundTaskIds: [...rebindByTaskId.keys()],
	};
}
