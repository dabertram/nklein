import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type AgentLedgerEvent, agentLedgerEventSchema } from "../core/agent-attempt-ledger";
import { parseValidatedJsonl } from "./jsonl-store";

/**
 * The persisted Agent Attempt Ledger (todo §5.AF) — a thin append-only JSONL wrapper over the pure
 * `src/core/agent-attempt-ledger.ts` schema + projections. One log file per workspace (keyed by the event's own
 * `workspacePathHash`, never the path itself — no host-path leak, #2). Best-effort durability: a write failure never
 * breaks the flow that produced the event (the ledger is observational control-plane, not in the critical path).
 *
 * Reads return the full event history in chronological order (oldest→newest by `recordedAt`) so the pure projections
 * (`latestRunState`, `summarizeModelOutcomes`, …) operate over the complete stream; an optional `limit` keeps the most
 * recent N. Schema-invalid lines are skipped + diagnosed by `parseValidatedJsonl`, never silently trusted.
 */

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "agent-attempt-ledger");

/**
 * F1.26b — an async-scoped ledger-root override so an isolated run (the replay-eval auto-capture's baseline/replay
 * passes) can direct EVERY ledger write within its async context to a private dir WITHOUT threading a `rootDir`
 * through the 16 deep `appendAgentLedgerEvent` call sites. Precedence: an explicit `rootDir` arg wins, then this
 * ambient scope, then the HOME-derived default. Byte-identical when unused (`getStore()` is undefined ⇒ DEFAULT_ROOT).
 * Uses `AsyncLocalStorage` (the same idiom as `LockedFileSystem`) so concurrent contexts never leak roots into each
 * other and the scope auto-restores on return — no process-global mutable state.
 */
const ledgerRootScope = new AsyncLocalStorage<string>();

/** Run `operation` with every unscoped ledger read/write inside it directed at `rootDir` (F1.26b isolated capture). */
export function runWithAgentLedgerRoot<T>(rootDir: string, operation: () => Promise<T>): Promise<T> {
	return ledgerRootScope.run(rootDir, operation);
}

function resolveRootDir(rootDir?: string): string {
	return rootDir ?? ledgerRootScope.getStore() ?? DEFAULT_ROOT;
}

function resolveLogPath(workspacePathHash: string, rootDir?: string): string {
	const key = workspacePathHash.trim() || "unknown";
	return join(resolveRootDir(rootDir), `${key}.jsonl`);
}

/** Append one validated ledger event to its workspace's log. Best-effort (never throws on a write failure). */
export async function appendAgentLedgerEvent(event: AgentLedgerEvent, options?: { rootDir?: string }): Promise<void> {
	// Validate at the boundary so a malformed event can never be persisted (would later be skipped on read anyway).
	const parsed = agentLedgerEventSchema.parse(event);
	const logPath = resolveLogPath(parsed.workspacePathHash, options?.rootDir);
	try {
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		await appendFile(logPath, `${JSON.stringify(parsed)}\n`, "utf8");
	} catch {
		// Best-effort durability only; a ledger write must never break the flow that produced the event.
	}
}

export interface ReadAgentLedgerOptions {
	workspacePathHash: string;
	rootDir?: string;
	/** Keep only the most-recent N events (the tail of the chronological stream). */
	limit?: number;
}

/** Read a workspace's ledger, chronological (oldest→newest by `recordedAt`); `limit` keeps the most-recent N. */
export async function readAgentLedger(options: ReadAgentLedgerOptions): Promise<AgentLedgerEvent[]> {
	const logPath = resolveLogPath(options.workspacePathHash, options.rootDir);
	let raw: string;
	try {
		raw = await readFile(logPath, "utf8");
	} catch {
		return [];
	}
	const events = parseValidatedJsonl(raw, agentLedgerEventSchema, "agent-attempt-ledger-store");
	events.sort((left, right) => left.recordedAt - right.recordedAt);
	if (typeof options.limit === "number" && options.limit >= 0) {
		return events.slice(Math.max(0, events.length - options.limit));
	}
	return events;
}

/**
 * Read EVERY workspace's ledger (all `*.jsonl` in the ledger dir), merged + chronological. For the operator read
 * surfaces (`nklein dev ledger`, future stats) that summarize model behaviour across all runs, not one workspace.
 */
export async function readAllAgentLedger(options?: { rootDir?: string }): Promise<AgentLedgerEvent[]> {
	const dir = resolveRootDir(options?.rootDir);
	let files: string[];
	try {
		files = (await readdir(dir)).filter((file) => file.endsWith(".jsonl"));
	} catch {
		return [];
	}
	const all: AgentLedgerEvent[] = [];
	for (const file of files) {
		try {
			const raw = await readFile(join(dir, file), "utf8");
			all.push(...parseValidatedJsonl(raw, agentLedgerEventSchema, "agent-attempt-ledger-store"));
		} catch {
			// Skip an unreadable file; never fail the whole read.
		}
	}
	all.sort((left, right) => left.recordedAt - right.recordedAt);
	return all;
}
