import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * Phase 7S / S11 — append-only jsonl audit log of injection PRE-SCREEN hits. When an ingestion point
 * ({@link screenUntrustedContent} at web-research/browse/search, later MCP/peer-agent) flags untrusted content as
 * `block` (quarantined) or `suspicious`, it records the event here so {@link summarizeInjectionEvents} + a `dev
 * security-events` read give the operator visibility into an active campaign against the agents (which surface, which
 * source, worst finding). Best-effort producer: a recording failure never breaks the ingestion path. Schema-invalid
 * lines are skipped + diagnosed, never trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "injection-events");

export const INJECTION_VERDICTS = ["block", "suspicious"] as const;

/** One recorded pre-screen hit: WHERE it came in, WHAT source, the verdict, and the machine-stable worst-finding code. */
export interface StoredInjectionEvent {
	/** The ingestion surface — "web-research" | "browse_url" | "web_search" | "mcp" | "peer-agent" | … */
	surface: string;
	/** The source identifier (a URL / repo path / agent id), truncated — never raw secrets. */
	source: string;
	verdict: (typeof INJECTION_VERDICTS)[number];
	/** The machine-stable code of the worst finding (e.g. "ignore_previous_instructions"). */
	worstFinding: string;
	/** ms epoch when it was recorded (the caller stamps it — the store never calls Date.now). */
	at: number;
}

export const storedInjectionEventSchema: z.ZodType<StoredInjectionEvent> = z.object({
	surface: z.string(),
	source: z.string(),
	verdict: z.enum(INJECTION_VERDICTS),
	worstFinding: z.string(),
	at: z.number(),
});

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_ROOT;
}
function resolveLogPath(rootDir?: string): string {
	return join(resolveRoot(rootDir), "log.jsonl");
}

/** Append injection events (one jsonl line each). Best-effort: callers should catch to stay non-fatal. */
export async function appendInjectionEvents(
	events: readonly StoredInjectionEvent[],
	options?: { rootDir?: string },
): Promise<void> {
	if (events.length === 0) {
		return;
	}
	const lines = events.map((event) => `${JSON.stringify(storedInjectionEventSchema.parse(event))}\n`).join("");
	await mkdir(resolveRoot(options?.rootDir), { recursive: true });
	await appendFile(resolveLogPath(options?.rootDir), lines, "utf8");
}

/** Read every recorded injection event (empty when the log is missing/unreadable — never throws). */
export async function readAllInjectionEvents(options?: { rootDir?: string }): Promise<StoredInjectionEvent[]> {
	const raw = await readFile(resolveLogPath(options?.rootDir), "utf8").catch(() => "");
	if (raw.trim() === "") {
		return [];
	}
	return parseValidatedJsonl(raw, storedInjectionEventSchema, "injection-event-store");
}
