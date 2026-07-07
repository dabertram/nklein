// §5.U cohesive extraction (2026-07-07): the workspace-state JSON-IO + PARSE primitives (readJsonFile, the node-error
// code check, empty-index factory, and index/save-payload parse), lifted out of `workspace-state.ts`. Depends only on
// the extracted schema/paths modules + node + persisted-state-file — nothing from workspace-state at RUNTIME (only a
// type), so the runtime module imports THIS one. Completes the paths → schema → io → orchestration layering.
import { readFile } from "node:fs/promises";
import { parsePersistedStateFile } from "./persisted-state-file";
import { formatSchemaIssues } from "./schema-issue-formatting";
import {
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	getWorkspaceIndexPath,
	getWorkspacesRootPath,
	INDEX_FILENAME,
} from "./workspace-state-paths";

// Re-exported for API compatibility — the workspace on-disk layout + path helpers now live in their own module (§5.U).
export {
	getCanonicalTaskWorktreesHomePath,
	getRuntimeHomePath,
	getTaskWorktreesHomePath,
	getWorkspaceDirectoryPath,
	getWorkspacesRootPath,
};

import type { InternalWorkspaceStateSaveRequest } from "./workspace-state";
import {
	INDEX_VERSION,
	internalWorkspaceStateSaveRequestSchema,
	type WorkspaceIndexFile,
	workspaceIndexFileSchema,
} from "./workspace-state-schema";

// Re-exported so external importers (workspace-registry.ts, project-health.ts) keep resolving it from here.
export type { RuntimeWorkspaceIndexEntry } from "./workspace-state-schema";

export function createEmptyWorkspaceIndex(): WorkspaceIndexFile {
	return {
		version: INDEX_VERSION,
		entries: {},
		repoPathToId: {},
	};
}

export function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

export async function readJsonFile(path: string): Promise<unknown | null> {
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

export function parseWorkspaceIndex(rawIndex: unknown | null): WorkspaceIndexFile {
	const indexPath = getWorkspaceIndexPath();
	return parsePersistedStateFile(
		indexPath,
		INDEX_FILENAME,
		rawIndex,
		workspaceIndexFileSchema,
		createEmptyWorkspaceIndex(),
	);
}

export function parseWorkspaceStateSavePayload(
	payload: InternalWorkspaceStateSaveRequest,
): InternalWorkspaceStateSaveRequest {
	const parsed = internalWorkspaceStateSaveRequestSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(`Invalid workspace state save payload. ${formatSchemaIssues(parsed.error)}`);
	}
	return parsed.data;
}
