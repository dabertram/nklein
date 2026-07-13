import { realpath, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
	type RuntimeBoardData,
	type RuntimeGitRepositoryInfo,
	type RuntimeTaskSessionSummary,
	type RuntimeWorkspaceStateResponse,
	type RuntimeWorkspaceStateSaveRequest,
	runtimeBoardDataSchema,
} from "../core/api-contract";
import { updateTaskDependencies } from "../core/task-board-mutations";
import { lockedFileSystem } from "../fs/locked-file-system";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isPathInsideTaskWorktreesHome } from "../workspace/task-worktree-path";
import { parsePersistedStateFile } from "./persisted-state-file";
import { exportLocalBoardToPortableCrdt, importPortableBoard, resolveMachineReplicaId } from "./portable-board-store";
import { createEmptyBoard, normalizeRuntimeBoardData } from "./runtime-board-normalization";
import { detectGitRepositoryInfo, detectGitRootAsync } from "./workspace-git-detection";
import { createWorkspaceIdCollisionSuffix, toWorkspaceIdBase } from "./workspace-id-generation";
import {
	BOARD_FILENAME,
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceBoardPath,
	getWorkspaceDirectoryLockRequest,
	getWorkspaceDirectoryPath,
	getWorkspaceIndexLockRequest,
	getWorkspaceIndexPath,
	getWorkspaceLocalBoardPath,
	getWorkspaceLocalIdentityPath,
	getWorkspaceLocalMetaPath,
	getWorkspaceLocalSessionsPath,
	getWorkspaceMetaPath,
	getWorkspaceSessionsPath,
	getWorkspacesRootLockRequest,
	getWorkspacesRootPath,
	META_FILENAME,
	SESSIONS_FILENAME,
	WORKSPACE_IDENTITY_FILENAME,
	WORKSPACE_LOCAL_STATE_DIR,
} from "./workspace-state-paths";

// Re-exported for API compatibility — the workspace on-disk layout + path helpers now live in their own module (§5.U).
export {
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	getWorkspacesRootPath,
};

import {
	INDEX_VERSION,
	type RuntimeWorkspaceIndexEntry,
	WORKSPACE_ID_COLLISION_SUFFIX_LENGTH,
	type WorkspaceIndexEntry,
	type WorkspaceIndexFile,
	type WorkspaceLocalIdentity,
	type WorkspaceStateMeta,
	workspaceLocalIdentitySchema,
	workspaceSessionsSchema,
	workspaceStateMetaSchema,
} from "./workspace-state-schema";

// Re-exported so external importers (workspace-registry.ts, project-health.ts) keep resolving it from here.
export type { RuntimeWorkspaceIndexEntry } from "./workspace-state-schema";

export type InternalWorkspaceStateSaveRequest = RuntimeWorkspaceStateSaveRequest & {
	sessions?: Record<string, RuntimeTaskSessionSummary>;
};

export interface RuntimeWorkspaceContext {
	repoPath: string;
	workspaceId: string;
	statePath: string;
	git: RuntimeGitRepositoryInfo;
	gitRepositoryCreatedByKanban?: boolean;
	displayName?: string | null;
	selfProjectConfirmed?: boolean;
	autoResumeEnabled?: boolean;
}

export interface LoadWorkspaceContextOptions {
	autoCreateIfMissing?: boolean;
	gitRepositoryCreatedByKanban?: boolean;
	displayName?: string;
	selfProjectConfirmed?: boolean;
	allowTaskWorktreeProject?: boolean;
	resolutionSource?: string;
	resolutionMetadata?: Record<string, unknown>;
}

function recordWorkspaceResolutionDecision(input: {
	repoPath: string;
	severity: "debug" | "info" | "warning";
	message: string;
	source: string;
	metadata?: Record<string, unknown>;
}): void {
	if (
		input.severity === "debug" &&
		input.metadata?.autoRegistered !== true &&
		(input.source === "existing_index" || input.source === "explicit_id" || input.source === "explicit_path")
	) {
		return;
	}
	recordSelfObservation({
		signal: "custom",
		severity: input.severity,
		message: input.message,
		workspacePath: input.repoPath,
		metadata: {
			operation: "workspace_resolution",
			source: input.source,
			...(input.metadata ?? {}),
		},
	});
}

import { parseWorkspaceIndex, parseWorkspaceStateSavePayload, readJsonFile } from "./workspace-state-io";

async function readExistingWorkspaceBoard(workspaceId: string): Promise<RuntimeBoardData | null> {
	const boardPath = getWorkspaceBoardPath(workspaceId);
	const rawBoard = await readJsonFile(boardPath);
	if (rawBoard === null) {
		return null;
	}
	return updateTaskDependencies(
		normalizeRuntimeBoardData(
			parsePersistedStateFile(boardPath, BOARD_FILENAME, rawBoard, runtimeBoardDataSchema, createEmptyBoard()),
		),
	);
}

async function readWorkspaceBoard(workspaceId: string): Promise<RuntimeBoardData> {
	return (
		(await readExistingWorkspaceBoard(workspaceId)) ??
		updateTaskDependencies(normalizeRuntimeBoardData(createEmptyBoard()))
	);
}

async function readWorkspaceBoardForContext(context: RuntimeWorkspaceContext): Promise<RuntimeBoardData> {
	const boardPath = getWorkspaceBoardPath(context.workspaceId);
	const rawBoard = await readJsonFile(boardPath);
	if (rawBoard !== null) {
		return updateTaskDependencies(
			normalizeRuntimeBoardData(
				parsePersistedStateFile(boardPath, BOARD_FILENAME, rawBoard, runtimeBoardDataSchema, createEmptyBoard()),
			),
		);
	}
	const localBoardPath = getWorkspaceLocalBoardPath(context.repoPath);
	const rawLocalBoard = await readJsonFile(localBoardPath);
	if (rawLocalBoard !== null) {
		return updateTaskDependencies(
			normalizeRuntimeBoardData(
				parsePersistedStateFile(
					localBoardPath,
					`${WORKSPACE_LOCAL_STATE_DIR}/${BOARD_FILENAME}`,
					rawLocalBoard,
					runtimeBoardDataSchema,
					createEmptyBoard(),
				),
			),
		);
	}
	// Cross-machine recovery (specsheet §14.2): with no runtime cache and no board mirror, recover from the
	// committed portable CRDT if present, re-resolving machine-local model assignments against this machine.
	try {
		const imported = await importPortableBoard({
			repoPath: context.repoPath,
			replicaId: await resolveMachineReplicaId(),
		});
		if (imported) {
			return updateTaskDependencies(normalizeRuntimeBoardData(imported.board));
		}
	} catch {
		// Portability recovery is best-effort; fall back to an empty board below.
	}
	return updateTaskDependencies(normalizeRuntimeBoardData(createEmptyBoard()));
}

export async function loadWorkspaceBoardById(workspaceId: string): Promise<RuntimeBoardData> {
	return await readWorkspaceBoard(workspaceId);
}

/** A strict by-ID read for liveness/safety callers that must distinguish an absent runtime board from an empty board. */
export async function loadExistingWorkspaceBoardById(workspaceId: string): Promise<RuntimeBoardData | null> {
	return await readExistingWorkspaceBoard(workspaceId);
}

async function readWorkspaceSessions(workspaceId: string): Promise<Record<string, RuntimeTaskSessionSummary>> {
	const sessionsPath = getWorkspaceSessionsPath(workspaceId);
	const rawSessions = await readJsonFile(sessionsPath);
	return parsePersistedStateFile(sessionsPath, SESSIONS_FILENAME, rawSessions, workspaceSessionsSchema, {});
}

async function readWorkspaceSessionsForContext(
	context: RuntimeWorkspaceContext,
): Promise<Record<string, RuntimeTaskSessionSummary>> {
	const sessionsPath = getWorkspaceSessionsPath(context.workspaceId);
	const rawSessions = await readJsonFile(sessionsPath);
	if (rawSessions !== null) {
		return parsePersistedStateFile(sessionsPath, SESSIONS_FILENAME, rawSessions, workspaceSessionsSchema, {});
	}
	const localSessionsPath = getWorkspaceLocalSessionsPath(context.repoPath);
	const rawLocalSessions = await readJsonFile(localSessionsPath);
	return parsePersistedStateFile(
		localSessionsPath,
		`${WORKSPACE_LOCAL_STATE_DIR}/${SESSIONS_FILENAME}`,
		rawLocalSessions,
		workspaceSessionsSchema,
		{},
	);
}

async function readWorkspaceMetaForContext(context: RuntimeWorkspaceContext): Promise<WorkspaceStateMeta> {
	const metaPath = getWorkspaceMetaPath(context.workspaceId);
	const rawMeta = await readJsonFile(metaPath);
	if (rawMeta !== null) {
		return parsePersistedStateFile(metaPath, META_FILENAME, rawMeta, workspaceStateMetaSchema, {
			revision: 0,
			updatedAt: 0,
		});
	}
	const localMetaPath = getWorkspaceLocalMetaPath(context.repoPath);
	const rawLocalMeta = await readJsonFile(localMetaPath);
	return parsePersistedStateFile(
		localMetaPath,
		`${WORKSPACE_LOCAL_STATE_DIR}/${META_FILENAME}`,
		rawLocalMeta,
		workspaceStateMetaSchema,
		{
			revision: 0,
			updatedAt: 0,
		},
	);
}

async function readWorkspaceLocalIdentity(repoPath: string): Promise<WorkspaceLocalIdentity | null> {
	const identityPath = getWorkspaceLocalIdentityPath(repoPath);
	const rawIdentity = await readJsonFile(identityPath);
	if (rawIdentity === null) {
		return null;
	}
	return parsePersistedStateFile(
		identityPath,
		`${WORKSPACE_LOCAL_STATE_DIR}/${WORKSPACE_IDENTITY_FILENAME}`,
		rawIdentity,
		workspaceLocalIdentitySchema,
		{
			version: 1,
			workspaceId: "",
			repoPath,
			updatedAt: 0,
		},
	);
}

async function writeWorkspaceStateFiles(
	context: RuntimeWorkspaceContext,
	board: RuntimeBoardData,
	sessions: Record<string, RuntimeTaskSessionSummary>,
	meta: WorkspaceStateMeta,
): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceBoardPath(context.workspaceId), board, {
		lock: null,
	});
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceSessionsPath(context.workspaceId), sessions, {
		lock: null,
	});
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceMetaPath(context.workspaceId), meta, {
		lock: null,
	});

	const identity: WorkspaceLocalIdentity = {
		version: 1,
		workspaceId: context.workspaceId,
		repoPath: context.repoPath,
		updatedAt: meta.updatedAt,
	};
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceLocalIdentityPath(context.repoPath), identity, {
		lock: null,
	});
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceLocalBoardPath(context.repoPath), board, {
		lock: null,
	});
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceLocalSessionsPath(context.repoPath), sessions, {
		lock: null,
	});
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceLocalMetaPath(context.repoPath), meta, {
		lock: null,
	});

	// Export the durable board into the committed, portable CRDT (specsheet §14.2). Best-effort: a portability
	// write must never break the primary state save.
	try {
		const replicaId = await resolveMachineReplicaId();
		await exportLocalBoardToPortableCrdt({ repoPath: context.repoPath, board, replicaId });
	} catch {
		// Portability mirror is non-critical; ignore failures.
	}
}

async function readWorkspaceIndex(): Promise<WorkspaceIndexFile> {
	const raw = await readJsonFile(getWorkspaceIndexPath());
	return parseWorkspaceIndex(raw);
}

async function writeWorkspaceIndex(index: WorkspaceIndexFile): Promise<void> {
	await lockedFileSystem.writeJsonFileAtomic(getWorkspaceIndexPath(), index, {
		lock: null,
	});
}

function createWorkspaceId(index: WorkspaceIndexFile, repoPath: string, preferredWorkspaceId?: string): string {
	if (preferredWorkspaceId) {
		const existingPreferredEntry = index.entries[preferredWorkspaceId];
		if (!existingPreferredEntry || existingPreferredEntry.repoPath === repoPath) {
			return preferredWorkspaceId;
		}
	}
	const baseId = toWorkspaceIdBase(repoPath);
	if (!index.entries[baseId] || index.entries[baseId]?.repoPath === repoPath) {
		return baseId;
	}

	for (let attempt = 0; attempt < 256; attempt += 1) {
		const candidate = `${baseId}-${createWorkspaceIdCollisionSuffix(WORKSPACE_ID_COLLISION_SUFFIX_LENGTH)}`;
		if (!index.entries[candidate] || index.entries[candidate]?.repoPath === repoPath) {
			return candidate;
		}
	}

	throw new Error(`Could not generate a unique workspace ID for ${repoPath}.`);
}

function ensureWorkspaceEntry(
	index: WorkspaceIndexFile,
	repoPath: string,
	gitRepositoryCreatedByKanban: boolean,
	preferredWorkspaceId?: string,
	displayName?: string,
	selfProjectConfirmed?: boolean,
): { index: WorkspaceIndexFile; entry: WorkspaceIndexEntry; changed: boolean } {
	const normalizedDisplayName = displayName?.trim() || undefined;
	const existingWorkspaceId = index.repoPathToId[repoPath];
	if (existingWorkspaceId) {
		const existingEntry = index.entries[existingWorkspaceId];
		if (existingEntry && existingEntry.repoPath === repoPath) {
			const shouldMarkGitCreated = gitRepositoryCreatedByKanban && !existingEntry.gitRepositoryCreatedByKanban;
			const shouldUpdateDisplayName =
				normalizedDisplayName !== undefined && existingEntry.displayName !== normalizedDisplayName;
			const shouldMarkSelfConfirmed = selfProjectConfirmed === true && !existingEntry.selfProjectConfirmed;
			if (shouldMarkGitCreated || shouldUpdateDisplayName || shouldMarkSelfConfirmed) {
				const updatedEntry = {
					...existingEntry,
					...(shouldMarkGitCreated ? { gitRepositoryCreatedByKanban: true } : {}),
					...(shouldUpdateDisplayName ? { displayName: normalizedDisplayName } : {}),
					...(shouldMarkSelfConfirmed ? { selfProjectConfirmed: true } : {}),
				};
				return {
					index: {
						...index,
						entries: {
							...index.entries,
							[existingWorkspaceId]: updatedEntry,
						},
					},
					entry: updatedEntry,
					changed: true,
				};
			}
			return {
				index,
				entry: existingEntry,
				changed: false,
			};
		}
	}

	const workspaceId = createWorkspaceId(index, repoPath, preferredWorkspaceId);

	const entry: WorkspaceIndexEntry = {
		workspaceId,
		repoPath,
		...(gitRepositoryCreatedByKanban ? { gitRepositoryCreatedByKanban: true } : {}),
		...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
		...(selfProjectConfirmed ? { selfProjectConfirmed: true } : {}),
	};

	return {
		index: {
			version: INDEX_VERSION,
			entries: {
				...index.entries,
				[workspaceId]: entry,
			},
			repoPathToId: {
				...index.repoPathToId,
				[repoPath]: workspaceId,
			},
		},
		entry,
		changed: true,
	};
}

function findWorkspaceEntry(index: WorkspaceIndexFile, repoPath: string): WorkspaceIndexEntry | null {
	const workspaceId = index.repoPathToId[repoPath];
	if (!workspaceId) {
		return null;
	}
	const entry = index.entries[workspaceId];
	if (!entry || entry.repoPath !== repoPath) {
		return null;
	}
	return entry;
}

async function toRuntimeWorkspaceContext(
	repoPath: string,
	entry: WorkspaceIndexEntry,
): Promise<RuntimeWorkspaceContext> {
	return {
		repoPath,
		workspaceId: entry.workspaceId,
		statePath: getWorkspaceDirectoryPath(entry.workspaceId),
		git: await detectGitRepositoryInfo(repoPath),
		gitRepositoryCreatedByKanban: entry.gitRepositoryCreatedByKanban === true,
		displayName: entry.displayName?.trim() || null,
		selfProjectConfirmed: entry.selfProjectConfirmed === true,
		autoResumeEnabled: entry.autoResumeEnabled === true,
	};
}

function workspaceEntryNeedsUpdate(entry: WorkspaceIndexEntry, options: LoadWorkspaceContextOptions): boolean {
	const requestedDisplayName = options.displayName?.trim() || undefined;
	return (
		(options.gitRepositoryCreatedByKanban === true && !entry.gitRepositoryCreatedByKanban) ||
		(requestedDisplayName !== undefined && entry.displayName !== requestedDisplayName) ||
		(options.selfProjectConfirmed === true && !entry.selfProjectConfirmed)
	);
}

export async function resolveWorkspacePath(cwd: string): Promise<string> {
	const resolvedCwd = resolve(cwd);
	let canonicalCwd = resolvedCwd;
	try {
		canonicalCwd = await realpath(resolvedCwd);
	} catch {
		canonicalCwd = resolvedCwd;
	}

	// Async git: resolveWorkspacePath is on every load/save, so a sync git spawn here blocks the runtime under load (§5.AI).
	const gitRoot = await detectGitRootAsync(canonicalCwd);
	if (!gitRoot) {
		throw new Error(`No git repository detected at ${canonicalCwd}`);
	}

	const resolvedGitRoot = resolve(gitRoot);
	try {
		return await realpath(resolvedGitRoot);
	} catch {
		return resolvedGitRoot;
	}
}

function toWorkspaceStateResponse(
	context: RuntimeWorkspaceContext,
	board: RuntimeBoardData,
	sessions: Record<string, RuntimeTaskSessionSummary>,
	revision: number,
): RuntimeWorkspaceStateResponse {
	return {
		repoPath: context.repoPath,
		statePath: context.statePath,
		git: context.git,
		board,
		sessions,
		revision,
	};
}

export class WorkspaceStateConflictError extends Error {
	readonly currentRevision: number;

	constructor(expectedRevision: number, currentRevision: number) {
		super(`Workspace state revision mismatch: expected ${expectedRevision}, current ${currentRevision}.`);
		this.name = "WorkspaceStateConflictError";
		this.currentRevision = currentRevision;
	}
}

/** True when an error is the proper-lockfile contention error (the workspace-state lock is held elsewhere). */
export function isWorkspaceStateLockError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Lock file is already being held");
}

export async function loadWorkspaceContext(
	cwd: string,
	options: LoadWorkspaceContextOptions = {},
): Promise<RuntimeWorkspaceContext> {
	const repoPath = await resolveWorkspacePath(cwd);
	const autoCreateIfMissing = options.autoCreateIfMissing ?? true;
	const isTaskWorktreePath = isPathInsideTaskWorktreesHome(repoPath, await getCanonicalTaskWorktreesHomePath());
	// The overwhelmingly common state-read path resolves an already-indexed workspace. Read it without taking the global
	// index write lock; otherwise every board poll queues behind that lock and its former in-lock Git introspection. The
	// locked path below is now reserved for actual registration/metadata mutation, with Git inspection after release.
	const currentIndex = await readWorkspaceIndex();
	const currentEntry = findWorkspaceEntry(currentIndex, repoPath);
	if (currentEntry && !workspaceEntryNeedsUpdate(currentEntry, options)) {
		recordWorkspaceResolutionDecision({
			repoPath,
			severity: "debug",
			message: `Workspace resolved from existing index: ${currentEntry.workspaceId}`,
			source: options.resolutionSource ?? "existing_index",
			metadata: {
				workspaceId: currentEntry.workspaceId,
				autoCreateIfMissing,
				allowTaskWorktreeProject: options.allowTaskWorktreeProject === true,
				...(options.resolutionMetadata ?? {}),
			},
		});
		return await toRuntimeWorkspaceContext(repoPath, currentEntry);
	}
	if (!autoCreateIfMissing || (options.allowTaskWorktreeProject !== true && isTaskWorktreePath)) {
		const existingEntry = currentEntry;
		if (!existingEntry) {
			if (isTaskWorktreePath) {
				recordWorkspaceResolutionDecision({
					repoPath,
					severity: "warning",
					message: "Workspace resolution rejected legacy task workspace auto-registration.",
					source: "rejected_task_worktree",
					metadata: {
						autoCreateIfMissing,
						allowTaskWorktreeProject: options.allowTaskWorktreeProject === true,
						...(options.resolutionMetadata ?? {}),
					},
				});
				throw new Error(
					`Legacy task workspace ${repoPath} is not a standalone !Klein project. Use the owning parent project path instead.`,
				);
			}
			recordWorkspaceResolutionDecision({
				repoPath,
				severity: "info",
				message: "Workspace resolution rejected an unregistered project while auto-create was disabled.",
				source: "unregistered_project",
				metadata: {
					autoCreateIfMissing,
					allowTaskWorktreeProject: options.allowTaskWorktreeProject === true,
					...(options.resolutionMetadata ?? {}),
				},
			});
			throw new Error(`Project ${repoPath} is not added to !Klein yet.`);
		}
		recordWorkspaceResolutionDecision({
			repoPath,
			severity: "debug",
			message: `Workspace resolved from existing index: ${existingEntry.workspaceId}`,
			source: options.resolutionSource ?? "existing_index",
			metadata: {
				workspaceId: existingEntry.workspaceId,
				autoCreateIfMissing,
				allowTaskWorktreeProject: options.allowTaskWorktreeProject === true,
				...(options.resolutionMetadata ?? {}),
			},
		});
		return await toRuntimeWorkspaceContext(repoPath, existingEntry);
	}

	const resolvedEntry = await lockedFileSystem.withLock(getWorkspaceIndexLockRequest(), async () => {
		let index = await readWorkspaceIndex();
		const localIdentity = await readWorkspaceLocalIdentity(repoPath);
		const ensured = ensureWorkspaceEntry(
			index,
			repoPath,
			options.gitRepositoryCreatedByKanban === true,
			localIdentity?.workspaceId,
			options.displayName,
			options.selfProjectConfirmed === true,
		);
		index = ensured.index;
		if (ensured.changed) {
			await writeWorkspaceIndex(index);
		}
		recordWorkspaceResolutionDecision({
			repoPath,
			severity: "debug",
			message: ensured.changed
				? `Workspace auto-registered: ${ensured.entry.workspaceId}`
				: `Workspace resolved from existing index: ${ensured.entry.workspaceId}`,
			source: options.resolutionSource ?? (ensured.changed ? "auto_registered" : "existing_index"),
			metadata: {
				workspaceId: ensured.entry.workspaceId,
				autoRegistered: ensured.changed,
				autoCreateIfMissing,
				allowTaskWorktreeProject: options.allowTaskWorktreeProject === true,
				gitRepositoryCreatedByKanban: options.gitRepositoryCreatedByKanban === true,
				...(localIdentity ? { localIdentityWorkspaceId: localIdentity.workspaceId } : {}),
				...(options.resolutionMetadata ?? {}),
			},
		});

		return ensured.entry;
	});
	return await toRuntimeWorkspaceContext(repoPath, resolvedEntry);
}

export async function loadWorkspaceContextById(
	workspaceId: string,
	options: {
		resolutionSource?: string;
		resolutionMetadata?: Record<string, unknown>;
	} = {},
): Promise<RuntimeWorkspaceContext | null> {
	const index = await readWorkspaceIndex();
	const entry = index.entries[workspaceId];
	if (!entry) {
		return null;
	}
	try {
		return await loadWorkspaceContext(entry.repoPath, {
			autoCreateIfMissing: false,
			resolutionSource: options.resolutionSource,
			resolutionMetadata: {
				requestedWorkspaceId: workspaceId,
				...(options.resolutionMetadata ?? {}),
			},
		});
	} catch (error) {
		if (isWorkspaceStateLockError(error)) {
			throw error;
		}
		return null;
	}
}

export async function listWorkspaceIndexEntries(): Promise<RuntimeWorkspaceIndexEntry[]> {
	const index = await readWorkspaceIndex();
	return Object.values(index.entries)
		.map((entry) => ({
			workspaceId: entry.workspaceId,
			repoPath: entry.repoPath,
			gitRepositoryCreatedByKanban: entry.gitRepositoryCreatedByKanban === true,
			displayName: entry.displayName?.trim() || null,
			selfProjectConfirmed: entry.selfProjectConfirmed === true,
			autoResumeEnabled: entry.autoResumeEnabled === true,
		}))
		.sort((left, right) => left.repoPath.localeCompare(right.repoPath));
}

export async function setWorkspaceAutoResumeEnabled(
	workspaceId: string,
	enabled: boolean,
): Promise<RuntimeWorkspaceIndexEntry | null> {
	return await lockedFileSystem.withLock(getWorkspaceIndexLockRequest(), async () => {
		const index = await readWorkspaceIndex();
		const entry = index.entries[workspaceId];
		if (!entry) {
			return null;
		}
		const updatedEntry: WorkspaceIndexEntry = {
			...entry,
			...(enabled ? { autoResumeEnabled: true } : { autoResumeEnabled: undefined }),
		};
		await writeWorkspaceIndex({
			...index,
			entries: {
				...index.entries,
				[workspaceId]: updatedEntry,
			},
		});
		return {
			workspaceId: updatedEntry.workspaceId,
			repoPath: updatedEntry.repoPath,
			gitRepositoryCreatedByKanban: updatedEntry.gitRepositoryCreatedByKanban === true,
			displayName: updatedEntry.displayName?.trim() || null,
			selfProjectConfirmed: updatedEntry.selfProjectConfirmed === true,
			autoResumeEnabled: updatedEntry.autoResumeEnabled === true,
		};
	});
}

export async function removeWorkspaceIndexEntry(workspaceId: string): Promise<boolean> {
	return await lockedFileSystem.withLock(getWorkspaceIndexLockRequest(), async () => {
		const index = await readWorkspaceIndex();
		const entry = index.entries[workspaceId];
		if (!entry) {
			return false;
		}
		delete index.entries[workspaceId];
		delete index.repoPathToId[entry.repoPath];
		await writeWorkspaceIndex(index);
		return true;
	});
}

export async function removeWorkspaceStateFiles(workspaceId: string): Promise<void> {
	await lockedFileSystem.withLocks(
		[getWorkspacesRootLockRequest(), getWorkspaceDirectoryLockRequest(workspaceId)],
		async () => {
			await rm(getWorkspaceDirectoryPath(workspaceId), {
				recursive: true,
				force: true,
			});
		},
	);
}

export async function loadWorkspaceState(cwd: string): Promise<RuntimeWorkspaceStateResponse> {
	const context = await loadWorkspaceContext(cwd);
	const board = await readWorkspaceBoardForContext(context);
	const sessions = await readWorkspaceSessionsForContext(context);
	const meta = await readWorkspaceMetaForContext(context);
	return toWorkspaceStateResponse(context, board, sessions, meta.revision);
}

export async function saveWorkspaceState(
	cwd: string,
	payload: InternalWorkspaceStateSaveRequest,
): Promise<RuntimeWorkspaceStateResponse> {
	const parsedPayload = parseWorkspaceStateSavePayload(payload);
	const context = await loadWorkspaceContext(cwd);
	return await lockedFileSystem.withLock(getWorkspaceDirectoryLockRequest(context.workspaceId), async () => {
		const currentMeta = await readWorkspaceMetaForContext(context);
		const expectedRevision = parsedPayload.expectedRevision;
		if (
			typeof expectedRevision === "number" &&
			Number.isInteger(expectedRevision) &&
			expectedRevision >= 0 &&
			expectedRevision !== currentMeta.revision
		) {
			throw new WorkspaceStateConflictError(expectedRevision, currentMeta.revision);
		}
		// Domain guard (todo §5.U M3): run the same normalization the load path applies, so a full board replacement from
		// a stale/buggy UI can't persist illegal state (cards in unknown columns, self/dangling/duplicate dependencies).
		// Idempotent for a valid board — the load already normalized it — so this only corrects malformed writes; OCC
		// (expectedRevision) above remains the staleness guard.
		const board = updateTaskDependencies(normalizeRuntimeBoardData(parsedPayload.board));
		const sessions = parsedPayload.sessions ?? (await readWorkspaceSessions(context.workspaceId));
		const nextRevision = currentMeta.revision + 1;
		const nextMeta: WorkspaceStateMeta = {
			revision: nextRevision,
			updatedAt: Date.now(),
		};

		await writeWorkspaceStateFiles(context, board, sessions, nextMeta);

		return toWorkspaceStateResponse(context, board, sessions, nextRevision);
	});
}

export interface RuntimeWorkspaceAtomicMutationResult<T> {
	board: RuntimeBoardData;
	sessions?: Record<string, RuntimeTaskSessionSummary>;
	value: T;
	save?: boolean;
}

export interface RuntimeWorkspaceAtomicMutationResponse<T> {
	value: T;
	state: RuntimeWorkspaceStateResponse;
	saved: boolean;
}

export async function mutateWorkspaceState<T>(
	cwd: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceAtomicMutationResult<T>,
): Promise<RuntimeWorkspaceAtomicMutationResponse<T>> {
	const context = await loadWorkspaceContext(cwd);
	return await lockedFileSystem.withLock(getWorkspaceDirectoryLockRequest(context.workspaceId), async () => {
		const currentBoard = await readWorkspaceBoardForContext(context);
		const currentSessions = await readWorkspaceSessionsForContext(context);
		const currentMeta = await readWorkspaceMetaForContext(context);
		const currentState = toWorkspaceStateResponse(context, currentBoard, currentSessions, currentMeta.revision);

		const mutation = mutate(currentState);
		if (mutation.save === false) {
			return {
				value: mutation.value,
				state: currentState,
				saved: false,
			};
		}

		const nextBoard = mutation.board;
		const nextSessions = mutation.sessions ?? currentSessions;
		const nextRevision = currentMeta.revision + 1;
		const nextMeta: WorkspaceStateMeta = {
			revision: nextRevision,
			updatedAt: Date.now(),
		};

		await writeWorkspaceStateFiles(context, nextBoard, nextSessions, nextMeta);

		return {
			value: mutation.value,
			state: toWorkspaceStateResponse(context, nextBoard, nextSessions, nextRevision),
			saved: true,
		};
	});
}
