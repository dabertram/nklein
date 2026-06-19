import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import {
	CLINE_HOME_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
	TASK_WORKTREES_DIR_NAME,
} from "../config/runtime-path-constants";
import {
	type RuntimeBoardColumnId,
	type RuntimeBoardData,
	type RuntimeGitRepositoryInfo,
	type RuntimeTaskSessionSummary,
	type RuntimeWorkspaceStateResponse,
	type RuntimeWorkspaceStateSaveRequest,
	runtimeBoardDataSchema,
	runtimeTaskSessionSummarySchema,
	runtimeWorkspaceStateSaveRequestSchema,
} from "../core/api-contract";
import { createGitProcessEnv } from "../core/git-process-env";
import { updateTaskDependencies } from "../core/task-board-mutations";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isPathInsideTaskWorktreesHome } from "../workspace/task-worktree-path";

const RUNTIME_HOME_PARENT_DIR = CLINE_HOME_DIR_NAME;
const RUNTIME_HOME_DIR = NKLEIN_RUNTIME_DIR_NAME;
const RUNTIME_WORKTREES_DIR = TASK_WORKTREES_DIR_NAME;
const WORKSPACES_DIR = "workspaces";
const INDEX_FILENAME = "index.json";
const BOARD_FILENAME = "board.json";
const SESSIONS_FILENAME = "sessions.json";
const META_FILENAME = "meta.json";
const WORKSPACE_LOCAL_STATE_DIR = "workspace";
const WORKSPACE_IDENTITY_FILENAME = "identity.json";
const INDEX_VERSION = 1;
const WORKSPACE_ID_COLLISION_SUFFIX_LENGTH = 4;

const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "planning", title: "Planning" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "review", title: "Review" },
	{ id: "completed", title: "Completed" },
	{ id: "trash", title: "Trash" },
];

interface WorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban?: boolean;
}

export interface RuntimeWorkspaceIndexEntry {
	workspaceId: string;
	repoPath: string;
	gitRepositoryCreatedByKanban: boolean;
}

interface WorkspaceIndexFile {
	version: number;
	entries: Record<string, WorkspaceIndexEntry>;
	repoPathToId: Record<string, string>;
}

interface WorkspaceStateMeta {
	revision: number;
	updatedAt: number;
}

interface WorkspaceLocalIdentity {
	version: 1;
	workspaceId: string;
	repoPath: string;
	updatedAt: number;
}

const workspaceLocalIdentitySchema = z.object({
	version: z.literal(1),
	workspaceId: z.string().min(1, "Workspace ID cannot be empty."),
	repoPath: z.string().min(1, "Workspace repository path cannot be empty."),
	updatedAt: z.number(),
});

const workspaceStateMetaSchema = z.object({
	revision: z.number().int().nonnegative(),
	updatedAt: z.number(),
});

const workspaceIndexEntrySchema = z.object({
	workspaceId: z.string().min(1, "Workspace ID cannot be empty."),
	repoPath: z.string().min(1, "Workspace repository path cannot be empty."),
	gitRepositoryCreatedByKanban: z.boolean().optional(),
});

const workspaceIndexFileSchema = z
	.object({
		version: z.literal(INDEX_VERSION),
		entries: z.record(z.string(), workspaceIndexEntrySchema),
		repoPathToId: z.record(z.string(), z.string().min(1, "Workspace ID cannot be empty.")),
	})
	.superRefine((index, context) => {
		for (const [workspaceId, entry] of Object.entries(index.entries)) {
			if (entry.workspaceId !== workspaceId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["entries", workspaceId, "workspaceId"],
					message: `Workspace ID must match entry key "${workspaceId}".`,
				});
			}
			const mappedWorkspaceId = index.repoPathToId[entry.repoPath];
			if (mappedWorkspaceId !== workspaceId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["entries", workspaceId, "repoPath"],
					message: `Missing repoPathToId mapping for "${entry.repoPath}" to "${workspaceId}".`,
				});
			}
		}

		for (const [repoPath, workspaceId] of Object.entries(index.repoPathToId)) {
			const entry = index.entries[workspaceId];
			if (!entry) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["repoPathToId", repoPath],
					message: `Mapped workspace "${workspaceId}" does not exist in entries.`,
				});
				continue;
			}
			if (entry.repoPath !== repoPath) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["repoPathToId", repoPath],
					message: `Mapped repoPath does not match workspace entry path "${entry.repoPath}".`,
				});
			}
		}
	});

const workspaceSessionsSchema = z
	.record(z.string(), runtimeTaskSessionSummarySchema)
	.superRefine((sessions, context) => {
		for (const [taskId, session] of Object.entries(sessions)) {
			if (session.taskId !== taskId) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [taskId, "taskId"],
					message: `Session taskId must match record key "${taskId}".`,
				});
			}
		}
	});

const internalWorkspaceStateSaveRequestSchema = runtimeWorkspaceStateSaveRequestSchema.extend({
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema).optional(),
});

export type InternalWorkspaceStateSaveRequest = RuntimeWorkspaceStateSaveRequest & {
	sessions?: Record<string, RuntimeTaskSessionSummary>;
};

export interface RuntimeWorkspaceContext {
	repoPath: string;
	workspaceId: string;
	statePath: string;
	git: RuntimeGitRepositoryInfo;
	gitRepositoryCreatedByKanban?: boolean;
}

export interface LoadWorkspaceContextOptions {
	autoCreateIfMissing?: boolean;
	gitRepositoryCreatedByKanban?: boolean;
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

function createEmptyBoard(): RuntimeBoardData {
	return {
		columns: BOARD_COLUMNS.map((column) => ({
			id: column.id,
			title: column.title,
			cards: [],
		})),
		dependencies: [],
	};
}

function normalizeRuntimeBoardData(board: RuntimeBoardData): RuntimeBoardData {
	const normalizedColumns: RuntimeBoardData["columns"] = BOARD_COLUMNS.map((column) => ({
		id: column.id,
		title: column.title,
		cards: [],
	}));
	const columnById = new Map(normalizedColumns.map((column) => [column.id, column]));
	for (const column of board.columns) {
		const normalizedColumn = columnById.get(column.id);
		if (!normalizedColumn) {
			continue;
		}
		normalizedColumn.cards.push(...column.cards);
	}
	return {
		columns: normalizedColumns,
		dependencies: board.dependencies,
	};
}

function createEmptyWorkspaceIndex(): WorkspaceIndexFile {
	return {
		version: INDEX_VERSION,
		entries: {},
		repoPathToId: {},
	};
}

export function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

export function getTaskWorktreesHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_WORKTREES_DIR);
}

export async function getCanonicalTaskWorktreesHomePath(): Promise<string> {
	const taskWorktreesHomePath = getTaskWorktreesHomePath();
	try {
		return await realpath(taskWorktreesHomePath);
	} catch {
		return taskWorktreesHomePath;
	}
}

export function getWorkspacesRootPath(): string {
	return join(getRuntimeHomePath(), WORKSPACES_DIR);
}

function getWorkspaceIndexPath(): string {
	return join(getWorkspacesRootPath(), INDEX_FILENAME);
}

export function getWorkspaceDirectoryPath(workspaceId: string): string {
	return join(getWorkspacesRootPath(), workspaceId);
}

function getWorkspaceBoardPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), BOARD_FILENAME);
}

function getWorkspaceSessionsPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), SESSIONS_FILENAME);
}

function getWorkspaceMetaPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), META_FILENAME);
}

function getWorkspaceLocalStateDirectoryPath(repoPath: string): string {
	return join(repoPath, ".cline", RUNTIME_HOME_DIR, WORKSPACE_LOCAL_STATE_DIR);
}

function getWorkspaceLocalBoardPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), BOARD_FILENAME);
}

function getWorkspaceLocalSessionsPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), SESSIONS_FILENAME);
}

function getWorkspaceLocalMetaPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), META_FILENAME);
}

function getWorkspaceLocalIdentityPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), WORKSPACE_IDENTITY_FILENAME);
}

function getWorkspaceIndexLockRequest(): LockRequest {
	return {
		path: getWorkspaceIndexPath(),
		type: "file",
	};
}

function getWorkspaceDirectoryLockRequest(workspaceId: string): LockRequest {
	return {
		path: getWorkspaceDirectoryPath(workspaceId),
		type: "directory",
		lockfilePath: join(getWorkspacesRootPath(), `${workspaceId}.lock`),
	};
}

function getWorkspacesRootLockRequest(): LockRequest {
	return {
		path: getWorkspacesRootPath(),
		type: "directory",
		lockfileName: ".workspaces.lock",
	};
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function readJsonFile(path: string): Promise<unknown | null> {
	try {
		const raw = await readFile(path, "utf8");
		try {
			return JSON.parse(raw) as unknown;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Malformed JSON in ${path}. ${message}`);
		}
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) {
			return null;
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not read JSON file at ${path}. ${message}`);
	}
}

function formatSchemaIssuePath(pathSegments: PropertyKey[]): string {
	if (pathSegments.length === 0) {
		return "root";
	}
	return pathSegments
		.map((segment) => {
			if (typeof segment === "number") {
				return `[${segment}]`;
			}
			return String(segment);
		})
		.join(".");
}

function formatSchemaIssues(error: z.ZodError): string {
	return error.issues.map((issue) => `${formatSchemaIssuePath(issue.path)}: ${issue.message}`).join("; ");
}

function parsePersistedStateFile<T>(
	filePath: string,
	fileLabel: string,
	raw: unknown | null,
	schema: z.ZodType<T>,
	defaultValue: T,
): T {
	if (raw === null) {
		return defaultValue;
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		throw new Error(
			`Invalid ${fileLabel} file at ${filePath}. ` +
				`Fix or remove the file. Validation errors: ${formatSchemaIssues(parsed.error)}`,
		);
	}
	return parsed.data;
}

function parseWorkspaceIndex(rawIndex: unknown | null): WorkspaceIndexFile {
	const indexPath = getWorkspaceIndexPath();
	return parsePersistedStateFile(
		indexPath,
		INDEX_FILENAME,
		rawIndex,
		workspaceIndexFileSchema,
		createEmptyWorkspaceIndex(),
	);
}

function parseWorkspaceStateSavePayload(payload: InternalWorkspaceStateSaveRequest): InternalWorkspaceStateSaveRequest {
	const parsed = internalWorkspaceStateSaveRequestSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(`Invalid workspace state save payload. ${formatSchemaIssues(parsed.error)}`);
	}
	return parsed.data;
}

async function readWorkspaceBoard(workspaceId: string): Promise<RuntimeBoardData> {
	const boardPath = getWorkspaceBoardPath(workspaceId);
	const rawBoard = await readJsonFile(boardPath);
	return updateTaskDependencies(
		normalizeRuntimeBoardData(
			parsePersistedStateFile(boardPath, BOARD_FILENAME, rawBoard, runtimeBoardDataSchema, createEmptyBoard()),
		),
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

export async function loadWorkspaceBoardById(workspaceId: string): Promise<RuntimeBoardData> {
	return await readWorkspaceBoard(workspaceId);
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

function toWorkspaceIdBase(repoPath: string): string {
	const trimmed = repoPath.trim().replace(/[\\/]+$/g, "");
	const folderName = basename(trimmed) || "project";
	const normalized = folderName
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "project";
}

function createWorkspaceIdCollisionSuffix(length: number): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	let suffix = "";
	while (suffix.length < length) {
		const bytes = randomBytes(length);
		for (const byte of bytes) {
			suffix += alphabet[byte % alphabet.length] ?? "";
			if (suffix.length === length) {
				break;
			}
		}
	}
	return suffix;
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
): { index: WorkspaceIndexFile; entry: WorkspaceIndexEntry; changed: boolean } {
	const existingWorkspaceId = index.repoPathToId[repoPath];
	if (existingWorkspaceId) {
		const existingEntry = index.entries[existingWorkspaceId];
		if (existingEntry && existingEntry.repoPath === repoPath) {
			if (gitRepositoryCreatedByKanban && !existingEntry.gitRepositoryCreatedByKanban) {
				const updatedEntry = {
					...existingEntry,
					gitRepositoryCreatedByKanban: true,
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

function runGitCapture(cwd: string, args: string[]): string | null {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		env: createGitProcessEnv(),
	});
	if (result.status !== 0 || typeof result.stdout !== "string") {
		return null;
	}
	const value = result.stdout.trim();
	return value.length > 0 ? value : null;
}

function detectGitRoot(cwd: string): string | null {
	return runGitCapture(cwd, ["rev-parse", "--show-toplevel"]);
}

function detectGitCurrentBranch(repoPath: string): string | null {
	return runGitCapture(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

function detectGitBranches(repoPath: string): string[] {
	// TODO: support showing remote branches again once worktree creation can safely fetch/pull
	// and resolve missing local tracking branches automatically.
	const output = runGitCapture(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]);
	if (!output) {
		return [];
	}

	const unique = new Set<string>();
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed === "HEAD") {
			continue;
		}
		unique.add(trimmed);
	}
	return Array.from(unique).sort((left, right) => left.localeCompare(right));
}

function detectGitDefaultBranch(repoPath: string, branches: string[]): string | null {
	const remoteHead = runGitCapture(repoPath, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (remoteHead) {
		const normalized = remoteHead.startsWith("origin/") ? remoteHead.slice("origin/".length) : remoteHead;
		if (normalized) {
			return normalized;
		}
	}
	if (branches.includes("main")) {
		return "main";
	}
	if (branches.includes("master")) {
		return "master";
	}
	return branches[0] ?? null;
}

function detectGitRepositoryInfo(repoPath: string): RuntimeGitRepositoryInfo {
	const gitRoot = detectGitRoot(repoPath);
	if (!gitRoot) {
		throw new Error(`No git repository detected at ${repoPath}`);
	}

	const currentBranch = detectGitCurrentBranch(repoPath);
	const branches = detectGitBranches(repoPath);
	const orderedBranches = currentBranch && !branches.includes(currentBranch) ? [currentBranch, ...branches] : branches;
	const defaultBranch = detectGitDefaultBranch(repoPath, orderedBranches);

	return {
		currentBranch,
		defaultBranch,
		branches: orderedBranches,
	};
}

export async function resolveWorkspacePath(cwd: string): Promise<string> {
	const resolvedCwd = resolve(cwd);
	let canonicalCwd = resolvedCwd;
	try {
		canonicalCwd = await realpath(resolvedCwd);
	} catch {
		canonicalCwd = resolvedCwd;
	}

	const gitRoot = detectGitRoot(canonicalCwd);
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

export async function loadWorkspaceContext(
	cwd: string,
	options: LoadWorkspaceContextOptions = {},
): Promise<RuntimeWorkspaceContext> {
	const repoPath = await resolveWorkspacePath(cwd);
	const autoCreateIfMissing = options.autoCreateIfMissing ?? true;
	const isTaskWorktreePath = isPathInsideTaskWorktreesHome(repoPath, await getCanonicalTaskWorktreesHomePath());
	if (!autoCreateIfMissing || (options.allowTaskWorktreeProject !== true && isTaskWorktreePath)) {
		const index = await readWorkspaceIndex();
		const existingEntry = findWorkspaceEntry(index, repoPath);
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
		return {
			repoPath,
			workspaceId: existingEntry.workspaceId,
			statePath: getWorkspaceDirectoryPath(existingEntry.workspaceId),
			git: detectGitRepositoryInfo(repoPath),
			gitRepositoryCreatedByKanban: existingEntry.gitRepositoryCreatedByKanban === true,
		};
	}

	return await lockedFileSystem.withLock(getWorkspaceIndexLockRequest(), async () => {
		let index = await readWorkspaceIndex();
		const localIdentity = await readWorkspaceLocalIdentity(repoPath);
		const ensured = ensureWorkspaceEntry(
			index,
			repoPath,
			options.gitRepositoryCreatedByKanban === true,
			localIdentity?.workspaceId,
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

		return {
			repoPath,
			workspaceId: ensured.entry.workspaceId,
			statePath: getWorkspaceDirectoryPath(ensured.entry.workspaceId),
			git: detectGitRepositoryInfo(repoPath),
			gitRepositoryCreatedByKanban: ensured.entry.gitRepositoryCreatedByKanban === true,
		};
	});
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
			resolutionSource: options.resolutionSource,
			resolutionMetadata: {
				requestedWorkspaceId: workspaceId,
				...(options.resolutionMetadata ?? {}),
			},
		});
	} catch {
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
		}))
		.sort((left, right) => left.repoPath.localeCompare(right.repoPath));
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
		const board = parsedPayload.board;
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
