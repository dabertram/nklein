import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { RuntimeBoardData, RuntimeProjectHealthIssue } from "../core/api-contract";
import type { RuntimeWorkspaceIndexEntry } from "../state/workspace-state";
import {
	getCanonicalTaskWorktreesHomePath,
	loadWorkspaceBoardById,
	loadWorkspaceState,
} from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isPathInsideTaskWorktreesHome } from "./task-worktree-path";

export interface ProjectHealthByWorkspaceIdInput {
	projects: readonly RuntimeWorkspaceIndexEntry[];
}

export type ProjectHealthIssuesByWorkspaceId = Map<string, RuntimeProjectHealthIssue[]>;

function normalizePathForComparison(path: string): string {
	return path.replaceAll("\\", "/").replace(/\/+$/g, "");
}

function parseTaskWorktreeTaskId(repoPath: string, worktreesHomePath: string): string | null {
	const relativePath = relative(worktreesHomePath, repoPath).replaceAll("\\", "/");
	if (!relativePath || relativePath.startsWith("../") || relativePath === "..") {
		return null;
	}
	const taskId = relativePath.split("/").filter((segment) => segment.length > 0)[0];
	return taskId?.trim() || null;
}

function boardHasTask(board: RuntimeBoardData, taskId: string): boolean {
	return board.columns.some((column) => column.cards.some((card) => card.id === taskId));
}

async function countPlanArtifacts(workspacePath: string): Promise<number> {
	const plansPath = join(workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansPath, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).length;
}

interface PendingPlanArtifactInfo {
	sourceTaskId: string | null;
}

function readPendingPlanArtifactInfo(value: unknown): PendingPlanArtifactInfo | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as { applicationStatus?: unknown; sourceTaskId?: unknown };
	if (record.applicationStatus !== "pending") {
		return null;
	}
	return {
		sourceTaskId: typeof record.sourceTaskId === "string" && record.sourceTaskId.trim() ? record.sourceTaskId : null,
	};
}

async function listPendingPlanArtifacts(workspacePath: string): Promise<PendingPlanArtifactInfo[]> {
	const plansPath = join(workspacePath, ".nklein", "nklein", "plans");
	const entries = await readdir(plansPath, { withFileTypes: true }).catch(() => []);
	const pending: PendingPlanArtifactInfo[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const raw = await readFile(join(plansPath, entry.name, "artifact.json"), "utf8").catch(() => null);
		if (!raw) {
			continue;
		}
		try {
			const info = readPendingPlanArtifactInfo(JSON.parse(raw) as unknown);
			if (info) {
				pending.push(info);
			}
		} catch {
			// Malformed artifact metadata is handled by artifact-specific flows.
		}
	}
	return pending;
}

async function findParentWorkspaceForTask(input: {
	projects: readonly RuntimeWorkspaceIndexEntry[];
	taskWorktreeProject: RuntimeWorkspaceIndexEntry;
	taskId: string;
	taskWorktreesHomePath: string;
}): Promise<RuntimeWorkspaceIndexEntry | null> {
	for (const project of input.projects) {
		if (project.workspaceId === input.taskWorktreeProject.workspaceId) {
			continue;
		}
		if (isPathInsideTaskWorktreesHome(project.repoPath, input.taskWorktreesHomePath)) {
			continue;
		}
		const board = await loadWorkspaceBoardById(project.workspaceId).catch(() => null);
		if (!board || !boardHasTask(board, input.taskId)) {
			continue;
		}
		return project;
	}
	return null;
}

export async function detectProjectHealthIssuesByWorkspaceId(
	input: ProjectHealthByWorkspaceIdInput,
): Promise<ProjectHealthIssuesByWorkspaceId> {
	const taskWorktreesHomePath = normalizePathForComparison(await getCanonicalTaskWorktreesHomePath());
	const result: ProjectHealthIssuesByWorkspaceId = new Map();
	for (const project of input.projects) {
		const issues: RuntimeProjectHealthIssue[] = [];
		const pendingArtifacts = await listPendingPlanArtifacts(project.repoPath);
		const pendingArtifactCount = pendingArtifacts.length;
		if (pendingArtifactCount > 0) {
			issues.push({
				kind: "pending_plan_artifacts",
				severity: "warning",
				title: "Pending generated plan artifacts",
				message:
					"This project has generated plan artifacts that have not been applied or rejected. Inspect the source card before cleaning up generated files.",
				taskId: null,
				parentWorkspaceId: null,
				parentWorkspacePath: null,
				artifactCount: pendingArtifactCount,
				canRemove: false,
				canMigrateArtifacts: false,
			});
		}
		const state = await loadWorkspaceState(project.repoPath).catch(() => null);
		if (state && pendingArtifactCount > 0) {
			const pendingArtifactSourceTaskIds = new Set(
				pendingArtifacts
					.map((artifact) => artifact.sourceTaskId)
					.filter((taskId): taskId is string => Boolean(taskId)),
			);
			const lostTaskIds = Object.values(state.sessions)
				.filter((session) => session.heartbeatStatus === "lost" && pendingArtifactSourceTaskIds.has(session.taskId))
				.map((session) => session.taskId)
				.sort((left, right) => left.localeCompare(right));
			if (lostTaskIds.length > 0) {
				issues.unshift({
					kind: "lost_session_pending_artifacts",
					severity: "error",
					title: "Lost session has pending artifacts",
					message:
						"A lost task session produced pending plan artifacts. Inspect the source card and apply or reject the artifacts before cleanup.",
					taskId: lostTaskIds[0] ?? null,
					parentWorkspaceId: null,
					parentWorkspacePath: null,
					artifactCount: pendingArtifacts.filter(
						(artifact) => artifact.sourceTaskId && lostTaskIds.includes(artifact.sourceTaskId),
					).length,
					canRemove: false,
					canMigrateArtifacts: false,
				});
			}
		}
		if (!isPathInsideTaskWorktreesHome(normalizePathForComparison(project.repoPath), taskWorktreesHomePath)) {
			result.set(project.workspaceId, issues);
			continue;
		}
		const taskId = parseTaskWorktreeTaskId(project.repoPath, taskWorktreesHomePath);
		const artifactCount = await countPlanArtifacts(project.repoPath);
		const parent =
			taskId === null
				? null
				: await findParentWorkspaceForTask({
						projects: input.projects,
						taskWorktreeProject: project,
						taskId,
						taskWorktreesHomePath,
					});
		if (parent) {
			recordSelfObservation({
				signal: "custom",
				severity: "debug",
				message: `Workspace resolution detected parent workspace for legacy task workspace project: ${parent.workspaceId}`,
				workspacePath: project.repoPath,
				metadata: {
					operation: "workspace_resolution",
					source: "parent_worktree",
					workspaceId: parent.workspaceId,
					parentWorkspaceId: parent.workspaceId,
					parentWorkspacePath: parent.repoPath,
					taskId,
				},
			});
		}
		issues.unshift({
			kind: parent ? "task_worktree_project" : "missing_parent_workspace",
			severity: parent ? "warning" : "error",
			title: parent ? "Legacy task workspace added as project" : "Legacy task workspace project has no parent",
			message: parent
				? "This project points at a legacy task workspace. Inspect it before removing the accidental project entry or migrating plan artifacts back to the parent project."
				: "This project points at a legacy task workspace, but !Klein could not find a parent project with the matching source card.",
			taskId,
			parentWorkspaceId: parent?.workspaceId ?? null,
			parentWorkspacePath: parent?.repoPath ?? null,
			artifactCount,
			canRemove: true,
			canMigrateArtifacts: artifactCount > 0 && parent !== null,
		});
		result.set(project.workspaceId, issues);
	}
	return result;
}
