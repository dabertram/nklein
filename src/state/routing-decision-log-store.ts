import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type RoutingDecisionRecord, routingDecisionRecordSchema } from "../core/routing-decision-log";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Append-only jsonl store for §5.AB routing-decision records — the effectful producer that lets
 * {@link summarizeRoutingCalibration} run over real decisions. One global log (routing decisions are a fleet-wide
 * signal, keyed by taskId); schema-invalid lines are skipped + diagnosed by {@link parseValidatedJsonl}, never trusted.
 * Recording is best-effort at the routing seam: a write failure must never break task start.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "routing-decision-log");

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}

function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append one decision record. Best-effort: validates, then appends; callers should catch to stay non-fatal. */
export async function appendRoutingDecision(
	record: RoutingDecisionRecord,
	options?: { rootDir?: string },
): Promise<void> {
	const parsed = routingDecisionRecordSchema.parse(record);
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), `${JSON.stringify(parsed)}\n`, "utf8");
}

/** Read every recorded routing decision (empty when the log is missing/unreadable — never throws). */
export async function readAllRoutingDecisions(options?: { rootDir?: string }): Promise<RoutingDecisionRecord[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, routingDecisionRecordSchema, "routing-decision-log-store");
}
