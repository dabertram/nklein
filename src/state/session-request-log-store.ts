import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type SessionRequestRecord, sessionRequestRecordSchema } from "../core/session-request-log";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * §dsh#31 slice A — the persisted SESSION REQUEST LOG: a thin append-only JSONL wrapper over the pure
 * `src/core/session-request-log.ts` schema. One file per session (keyed by a sanitized sessionId), so a single
 * session's stream stays small and independently inspectable/deletable.
 *
 * OBSERVE-FIRST GATE: recording is OFF unless `NKLEIN_SESSION_REQUEST_LOG=1` — verbatim wire messages are big
 * (a 25k-token prompt ≈ 100KB per turn), so the log runs in measurement rigs (real-model-run.sh,
 * verify-simulated-flow) before any always-on decision. Same best-effort durability contract as the attempt
 * ledger: a write failure never breaks the flow that produced the request.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "session-request-log");

const REQUEST_LOG_ENV_VAR = "NKLEIN_SESSION_REQUEST_LOG";
const REQUEST_LOG_ROOT_ENV_VAR = "NKLEIN_SESSION_REQUEST_LOG_ROOT";

/** True when the observe-first gate is open (recording enabled for this process). */
export function isSessionRequestLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[REQUEST_LOG_ENV_VAR]?.trim() === "1";
}

function resolveRootDir(rootDir?: string): string {
	const envRoot = process.env[REQUEST_LOG_ROOT_ENV_VAR]?.trim();
	return rootDir ?? (envRoot && envRoot.length > 0 ? envRoot : DEFAULT_ROOT);
}

/** Session ids may carry path-hostile characters (synthetic scopes like "consult:<taskId>") — sanitize, never join raw. */
function sessionFileName(sessionId: string): string {
	const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
	return `${safe || "unknown"}.jsonl`;
}

export function sessionRequestLogPath(sessionId: string, rootDir?: string): string {
	return join(resolveRootDir(rootDir), sessionFileName(sessionId));
}

/** Append one validated record to its session's log. Best-effort: never throws. No-op while the gate is closed. */
export async function appendSessionRequestRecord(
	record: SessionRequestRecord,
	options?: { rootDir?: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
	if (!isSessionRequestLogEnabled(options?.env ?? process.env)) {
		return;
	}
	try {
		const parsed = sessionRequestRecordSchema.parse(record);
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		await appendFile(
			sessionRequestLogPath(parsed.sessionId, options?.rootDir),
			`${JSON.stringify(parsed)}\n`,
			"utf8",
		);
	} catch {
		// Best-effort observational log; a write failure must never break the request that produced it.
	}
}

/** Read one session's records in append order. Missing file ⇒ empty history. */
export async function readSessionRequestRecords(
	sessionId: string,
	options?: { rootDir?: string },
): Promise<SessionRequestRecord[]> {
	try {
		const content = await readFile(sessionRequestLogPath(sessionId, options?.rootDir), "utf8");
		return parseValidatedJsonl(content, sessionRequestRecordSchema, "session-request-log");
	} catch {
		return [];
	}
}

/** List every session id that has a log file (by file name, i.e. the sanitized form). */
export async function listSessionRequestLogSessions(options?: { rootDir?: string }): Promise<string[]> {
	try {
		const entries = await readdir(resolveRootDir(options?.rootDir));
		return entries.filter((entry) => entry.endsWith(".jsonl")).map((entry) => entry.slice(0, -".jsonl".length));
	} catch {
		return [];
	}
}
