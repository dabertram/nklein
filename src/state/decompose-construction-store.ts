import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";

/**
 * P0.DSTALL layer 3: DURABLE incremental-decompose construction state. The per-(workspace, card) builder
 * already survives in-process session restarts (live-found 20260810-103422), but a RUNTIME teardown lost it
 * entirely — Dschinn run 4 built a 30-node graph over 37 minutes and the teardown evaporated it. Every
 * accepted op now checkpoints here; a fresh process resumes the construction instead of starting from zero.
 *
 * Files are keyed by (workspace-path HASH, task id) — the workspace path itself never lands on disk (the
 * ledger's no-host-path-leak rule). Sync I/O on purpose: the writers are synchronous tool handlers and the
 * files are small (a few KB); a failed write must never break the model's turn (best-effort, loud via the
 * returned flag).
 */

const STORE_DIR = join(resolveNkleinRuntimeHomePath(homedir()), "decompose-constructions");

const persistedConstructionSchema = z.object({
	schemaVersion: z.literal(1),
	savedAt: z.number().int().positive(),
	construction: z.object({
		nodes: z.array(z.object({ id: z.string(), label: z.string().optional() }).passthrough()),
		edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
	}),
	/** Full task payloads by id (opaque plan-task JSON). */
	tasks: z.array(z.tuple([z.string(), z.unknown()])),
	rejectedOpCount: z.number().int().nonnegative(),
});
export type PersistedDecomposeConstruction = z.infer<typeof persistedConstructionSchema>;

function fileFor(workspacePath: string, taskId: string, rootDir?: string): string {
	const safeTask = taskId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
	return join(rootDir ?? STORE_DIR, `${hashWorkspacePathForLedger(workspacePath)}-${safeTask}.json`);
}

export function saveDecomposeConstruction(
	workspacePath: string,
	taskId: string,
	snapshot: Omit<PersistedDecomposeConstruction, "schemaVersion" | "savedAt">,
	rootDir?: string,
): boolean {
	try {
		const path = fileFor(workspacePath, taskId, rootDir);
		mkdirSync(rootDir ?? STORE_DIR, { recursive: true });
		writeFileSync(
			path,
			JSON.stringify({
				...snapshot,
				schemaVersion: 1,
				savedAt: Date.now(),
			} satisfies PersistedDecomposeConstruction),
			"utf8",
		);
		return true;
	} catch {
		return false;
	}
}

export function loadDecomposeConstruction(
	workspacePath: string,
	taskId: string,
	rootDir?: string,
): PersistedDecomposeConstruction | null {
	try {
		const raw = readFileSync(fileFor(workspacePath, taskId, rootDir), "utf8");
		const parsed = persistedConstructionSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** Called on successful apply / deliberate reset — a consumed construction must not resurrect. */
export function clearDecomposeConstruction(workspacePath: string, taskId: string, rootDir?: string): void {
	try {
		rmSync(fileFor(workspacePath, taskId, rootDir), { force: true });
	} catch {
		// best effort
	}
}
