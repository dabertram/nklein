import { loadRuntimeConfig } from "../../config/runtime-config";
import type { RuntimeWorkspaceStateResponse } from "../../core/api-contract";
import { resolveAutonomousTimeoutPowerMultiplier } from "../../core/autonomous-timeout-defaults";
import { buildDecompositionRoutingCandidates } from "../../nklein-agent/decomposition/build-decomposition-routing-candidates.js";
import { applyNKleinPlanTaskGraphToBoard } from "../../nklein-agent/nklein-decomposition-tool";
import {
	readNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
} from "../../nklein-agent/nklein-plan-artifacts";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import { toErrorMessage } from "./task-command-output.js";
import { formatDependencyRecord, formatTaskRecord } from "./task-record-format.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	resolveTaskBaseRef,
	resolveWorkspaceRepoPath,
	updateRuntimeWorkspaceState,
} from "./task-runtime-workspace.js";

/**
 * The "decompose a saved plan into a task graph" CLI command (§5.U-extracted from task.ts) + its rejection telemetry:
 * apply a plan's task-graph artifact onto the board (creating the cards + dependencies via the routing candidates), and
 * on failure record a `decomposition_rejected` self-observation before re-throwing. Leaf command — no dependency on the
 * other task command implementations.
 */

type JsonRecord = Record<string, unknown>;
type RecordSelfObservation = typeof recordSelfObservation;

interface DecompositionRejectionInput {
	workspacePath: string;
	slug: string;
	title?: string;
	specPath?: string;
	planPath?: string;
	questionsPath?: string;
	decisionsPath?: string;
	revisionsPath?: string;
	summaryPath?: string;
	taskGraphPath?: string;
	error: unknown;
	recordObservation?: RecordSelfObservation;
}

export function recordDecompositionRejection(input: DecompositionRejectionInput): void {
	const message = toErrorMessage(input.error);
	(input.recordObservation ?? recordSelfObservation)({
		signal: "decomposition_rejected",
		severity: "warning",
		message: `Task decomposition rejected for plan "${input.slug}": ${message}`,
		workspacePath: input.workspacePath,
		metadata: {
			slug: input.slug,
			title: input.title ?? null,
			specPath: input.specPath ?? null,
			planPath: input.planPath ?? null,
			questionsPath: input.questionsPath ?? null,
			decisionsPath: input.decisionsPath ?? null,
			revisionsPath: input.revisionsPath ?? null,
			summaryPath: input.summaryPath ?? null,
			taskGraphPath: input.taskGraphPath ?? null,
			error: message,
		},
	});
}

export async function decomposeTaskGraph(input: {
	cwd: string;
	slug: string;
	projectPath?: string;
	baseRef?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const artifacts = await readNKleinPlanArtifacts(workspaceRepoPath, input.slug);
	const runtimeConfig = await loadRuntimeConfig(workspaceRepoPath);
	const routingCandidates = await buildDecompositionRoutingCandidates(runtimeConfig);
	const powerMultiplier = await resolveAutonomousTimeoutPowerMultiplier();
	let applied: {
		createdTasks: JsonRecord[];
		createdDependencies: JsonRecord[];
		taskIdByPlanTaskId: Record<string, string>;
		preview: JsonRecord;
	};
	try {
		applied = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (runtimeState) => {
			const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(runtimeState);
			if (!resolvedBaseRef) {
				throw new Error("Could not determine task base branch for this workspace.");
			}
			const result = applyNKleinPlanTaskGraphToBoard({
				board: runtimeState.board,
				taskGraph: artifacts.taskGraph,
				baseRef: resolvedBaseRef,
				randomUuid: () => globalThis.crypto.randomUUID(),
				modelRoleSettings: runtimeConfig.effectiveModelRoles,
				powerMultiplier,
				routingCandidates,
				sharedContext: {
					spec: artifacts.spec,
					decisionsMarkdown: artifacts.decisionsMarkdown,
				},
			});
			const nextState: RuntimeWorkspaceStateResponse = {
				...runtimeState,
				board: result.board,
			};
			return {
				board: result.board,
				value: {
					createdTasks: result.createdTasks.map((task) => formatTaskRecord(nextState, task, "planning")),
					createdDependencies: result.createdDependencies.map((dependency) =>
						formatDependencyRecord(nextState, dependency),
					),
					taskIdByPlanTaskId: result.taskIdByPlanTaskId,
					preview: result.preview as unknown as JsonRecord,
				},
			};
		});
	} catch (error) {
		recordDecompositionRejection({
			workspacePath: workspaceRepoPath,
			slug: artifacts.taskGraph.slug,
			title: artifacts.taskGraph.title,
			specPath: artifacts.specPath,
			planPath: artifacts.planPath,
			questionsPath: artifacts.questionsPath,
			decisionsPath: artifacts.decisionsPath,
			revisionsPath: artifacts.revisionsPath,
			summaryPath: artifacts.summaryPath,
			taskGraphPath: artifacts.taskGraphPath,
			error,
		});
		throw error;
	}
	await updateNKleinPlanArtifactApplicationStatus({
		workspacePath: workspaceRepoPath,
		slug: artifacts.taskGraph.slug,
		applicationStatus: "applied",
	});

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		plan: {
			artifactId: artifacts.artifactId,
			slug: artifacts.taskGraph.slug,
			title: artifacts.taskGraph.title,
			specPath: artifacts.specPath,
			planPath: artifacts.planPath,
			questionsPath: artifacts.questionsPath,
			decisionsPath: artifacts.decisionsPath,
			revisionsPath: artifacts.revisionsPath,
			summaryPath: artifacts.summaryPath,
			taskGraphPath: artifacts.taskGraphPath,
		},
		tasks: applied.createdTasks,
		dependencies: applied.createdDependencies,
		taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
		preview: applied.preview,
		count: applied.createdTasks.length,
	};
}
