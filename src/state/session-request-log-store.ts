import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	type SessionRequestRecord,
	type SessionResponseRecord,
	sessionRequestRecordSchema,
	sessionResponseRecordSchema,
} from "../core/session-request-log";
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

/**
 * Capture mode (F2.30(e), David 2026-09-02 "i always want to be able to see all in and out from the models"):
 *  - "bounded" (DEFAULT): always-on capture with per-field caps applied by the tap and a per-session file cap
 *    here — safe to leave on for real runs; the wire view always has something to show.
 *  - "full" (`NKLEIN_SESSION_REQUEST_LOG=1`): verbatim capture, no caps — measurement rigs (unchanged).
 *  - "off" (`NKLEIN_SESSION_REQUEST_LOG=0`): no capture at all.
 */
export type SessionRequestLogMode = "off" | "bounded" | "full";

export function sessionRequestLogMode(env: NodeJS.ProcessEnv = process.env): SessionRequestLogMode {
	const raw = env[REQUEST_LOG_ENV_VAR]?.trim();
	if (raw === "1") {
		return "full";
	}
	if (raw === "0") {
		return "off";
	}
	return "bounded";
}

/** True when the gate is open in any mode (bounded default included). */
export function isSessionRequestLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return sessionRequestLogMode(env) !== "off";
}

/** Bounded mode's per-session file cap — appends beyond it are dropped (full mode is uncapped). */
const BOUNDED_FILE_CAP_BYTES = 16 * 1024 * 1024;

async function underBoundedCap(path: string): Promise<boolean> {
	try {
		return (await stat(path)).size < BOUNDED_FILE_CAP_BYTES;
	} catch {
		return true; // no file yet
	}
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
		const path = sessionRequestLogPath(parsed.sessionId, options?.rootDir);
		if (sessionRequestLogMode(options?.env ?? process.env) === "bounded" && !(await underBoundedCap(path))) {
			return; // per-session cap reached — bounded mode drops silently (full mode never caps)
		}
		await appendFile(path, `${JSON.stringify(parsed)}\n`, "utf8");
	} catch {
		// Best-effort observational log; a write failure must never break the request that produced it.
	}
}

/** Append one RESPONSE record (F2.30(e) "out" half). Same gate, cap, and best-effort contract as requests. */
export async function appendSessionResponseRecord(
	record: SessionResponseRecord,
	options?: { rootDir?: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
	if (!isSessionRequestLogEnabled(options?.env ?? process.env)) {
		return;
	}
	try {
		const parsed = sessionResponseRecordSchema.parse(record);
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		const path = sessionRequestLogPath(parsed.sessionId, options?.rootDir);
		if (sessionRequestLogMode(options?.env ?? process.env) === "bounded" && !(await underBoundedCap(path))) {
			return;
		}
		await appendFile(path, `${JSON.stringify(parsed)}\n`, "utf8");
	} catch {
		// Best-effort observational log; a write failure must never break the response that produced it.
	}
}

const sessionWireRecordSchema = z.union([sessionResponseRecordSchema, sessionRequestRecordSchema]);
export type SessionWireRecord = z.infer<typeof sessionWireRecordSchema>;

/** Read one session's FULL wire history (requests + responses) in append order. Missing file ⇒ empty. */
export async function readSessionWireRecords(
	sessionId: string,
	options?: { rootDir?: string },
): Promise<SessionWireRecord[]> {
	try {
		const content = await readFile(sessionRequestLogPath(sessionId, options?.rootDir), "utf8");
		return parseValidatedJsonl(content, sessionWireRecordSchema, "session-request-log");
	} catch {
		return [];
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
