import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type SessionInjectionRecord, sessionInjectionRecordSchema } from "../core/session-injection-log";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * §dsh#31 slice B1 — the persisted WRITE-AHEAD INJECTION LOG: a thin append-only JSONL wrapper over the pure
 * `src/core/session-injection-log.ts` schema, one file per session.
 *
 * Unlike the verbatim request log (rig-gated: whole prompts are big), injection records are the SMALL rail/
 * note texts the hook adds — so this log is ON BY DEFAULT in production, which is the point of "model-visible
 * means logged": the durable record of what reached the model must not depend on running inside a rig.
 * `NKLEIN_INJECTION_LOG=0` is the escape hatch. Best-effort like every observational ledger: a write failure
 * never breaks the turn that produced the injection.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "session-injection-log");

const INJECTION_LOG_ENV_VAR = "NKLEIN_INJECTION_LOG";
const INJECTION_LOG_ROOT_ENV_VAR = "NKLEIN_INJECTION_LOG_ROOT";

/** Default ON; only an explicit "0" closes it. */
export function isSessionInjectionLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[INJECTION_LOG_ENV_VAR]?.trim() !== "0";
}

function resolveRootDir(rootDir?: string): string {
	const envRoot = process.env[INJECTION_LOG_ROOT_ENV_VAR]?.trim();
	return rootDir ?? (envRoot && envRoot.length > 0 ? envRoot : DEFAULT_ROOT);
}

function sessionFileName(sessionId: string): string {
	const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
	return `${safe || "unknown"}.jsonl`;
}

export function sessionInjectionLogPath(sessionId: string, rootDir?: string): string {
	return join(resolveRootDir(rootDir), sessionFileName(sessionId));
}

/** Append validated records (one line each). Best-effort: never throws. No-op when disabled or empty. */
export async function appendSessionInjectionRecords(
	records: readonly SessionInjectionRecord[],
	options?: { rootDir?: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
	if (records.length === 0 || !isSessionInjectionLogEnabled(options?.env ?? process.env)) {
		return;
	}
	try {
		const parsed = records.map((record) => sessionInjectionRecordSchema.parse(record));
		const bySession = new Map<string, SessionInjectionRecord[]>();
		for (const record of parsed) {
			const bucket = bySession.get(record.sessionId) ?? [];
			bucket.push(record);
			bySession.set(record.sessionId, bucket);
		}
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		for (const [sessionId, sessionRecords] of bySession) {
			const lines = sessionRecords.map((record) => `${JSON.stringify(record)}\n`).join("");
			await appendFile(sessionInjectionLogPath(sessionId, options?.rootDir), lines, "utf8");
		}
	} catch {
		// Observational log only — a write failure must never break the turn that produced the injection.
	}
}

/** Read one session's injection records in append order. Missing file ⇒ empty history. */
export async function readSessionInjectionRecords(
	sessionId: string,
	options?: { rootDir?: string },
): Promise<SessionInjectionRecord[]> {
	try {
		const content = await readFile(sessionInjectionLogPath(sessionId, options?.rootDir), "utf8");
		return parseValidatedJsonl(content, sessionInjectionRecordSchema, "session-injection-log");
	} catch {
		return [];
	}
}
