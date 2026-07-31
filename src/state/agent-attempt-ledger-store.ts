import { AsyncLocalStorage } from "node:async_hooks";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type AgentLedgerEvent, agentLedgerEventSchema } from "../core/agent-attempt-ledger";
import { isAttributableModelKey } from "../core/model-identity";
import { lockedFileSystem } from "../fs/locked-file-system";
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

/**
 * F1.26b — env override for the ledger root, honored by the whole runtime. The auto-capture runs the scenario suite in
 * a SUBPROCESS runtime (the proven `verify-simulated-flow` machinery); AsyncLocalStorage can't cross that process
 * boundary, so the child is spawned with `NKLEIN_AGENT_LEDGER_ROOT=<ledgerRootDir>` and every ledger write in that
 * process lands in the isolated dir. Below the explicit arg + the in-process scope so those still win; unset ⇒ default.
 */
const LEDGER_ROOT_ENV_VAR = "NKLEIN_AGENT_LEDGER_ROOT";

function resolveRootDir(rootDir?: string): string {
	const envRoot = process.env[LEDGER_ROOT_ENV_VAR]?.trim();
	return rootDir ?? ledgerRootScope.getStore() ?? (envRoot && envRoot.length > 0 ? envRoot : DEFAULT_ROOT);
}

function resolveLogPath(workspacePathHash: string, rootDir?: string): string {
	const key = workspacePathHash.trim() || "unknown";
	return join(resolveRootDir(rootDir), `${key}.jsonl`);
}

/**
 * The on-disk path of one workspace's ledger — exported so the durable-scheduler CLAIM (P21.5b) locks the EXACT
 * file it is fencing.
 *
 * Deliberately not re-derived by the caller: a lock computed from its own `join(root, hash + ".jsonl")` would
 * drift the moment this layout changed, and it would drift SILENTLY — the lock would still be acquired, just on a
 * path nothing writes to, so every server would claim successfully and the fence would protect nothing while
 * looking healthy.
 */
export function agentLedgerLogPath(workspacePathHash: string, rootDir?: string): string {
	return resolveLogPath(workspacePathHash, rootDir);
}

/**
 * Append one validated ledger event to its workspace's log. Best-effort (never throws on a write failure).
 *
 * ── AN ATTEMPT THAT NAMES NO MODEL IS REFUSED HERE (2026-07-31) ──
 * The attempt ledger exists to be projected PER MODEL — fitness, the §5.AA behaviour profile, edit reliability,
 * and the routing evidence the start path looks up by model key. An attempt whose model could not be resolved is
 * therefore not a weak record, it is a **phantom model**: `normalizeModelId("")` yields the well-formed key
 * `lmstudio:unknown:default`, which then forms its own row in every per-model rollup and looks exactly like a
 * real one.
 *
 * **Measured on the live ledger before the fix: 70 of 238 attempts (29%) were unattributable, carrying 1074 tool
 * calls that belong to other models.** They also arrived in bursts with identical timestamps across workspaces —
 * a restart re-terminating tasks that had already finished — so the same transcript was re-recorded up to 12
 * times, inflating `retriesBefore` to 14 on a card that succeeded on its first attempt.
 *
 * The guard lives at this door rather than at the writer because this is the ONE door: no present or future
 * caller can route around it. The terminal state itself is NOT lost — `recordTaskRunSummary` writes it to its own
 * durable store unconditionally, on the same path. What is refused is only the claim that some model made this
 * attempt.
 */
export async function appendAgentLedgerEvent(event: AgentLedgerEvent, options?: { rootDir?: string }): Promise<void> {
	// Validate at the boundary so a malformed event can never be persisted (would later be skipped on read anyway).
	const parsed = agentLedgerEventSchema.parse(event);
	if (parsed.kind === "attempt" && !isAttributableModelKey(parsed.modelId)) {
		return;
	}
	const logPath = resolveLogPath(parsed.workspacePathHash, options?.rootDir);
	try {
		await mkdir(resolveRootDir(options?.rootDir), { recursive: true });
		await appendFile(logPath, `${JSON.stringify(parsed)}\n`, "utf8");
	} catch {
		// Best-effort durability only; a ledger write must never break the flow that produced the event.
	}
}

/**
 * Append a deterministic event exactly once by `eventId`, under the same cross-process file lock used by other
 * durable state. This is the transactional-outbox sink for effects (such as trigger audits) that may be retried
 * after a SIGKILL between their primary state mutation and acknowledgement.
 *
 * Returns true only when this call appended. Best-effort like the ordinary ledger writer: persistence failure
 * returns false and never breaks the product path; a later retry can try again because no event was written.
 */
export async function appendAgentLedgerEventOnce(
	event: AgentLedgerEvent,
	options?: { rootDir?: string },
): Promise<boolean> {
	const parsed = agentLedgerEventSchema.parse(event);
	const rootDir = resolveRootDir(options?.rootDir);
	const logPath = resolveLogPath(parsed.workspacePathHash, rootDir);
	try {
		await mkdir(rootDir, { recursive: true });
		return await lockedFileSystem.withLock({ path: logPath, type: "file" }, async () => {
			const raw = await readFile(logPath, "utf8").catch(() => "");
			const existing = parseValidatedJsonl(raw, agentLedgerEventSchema, "agent-attempt-ledger-store");
			if (existing.some((candidate) => candidate.eventId === parsed.eventId)) {
				return false;
			}
			await appendFile(logPath, `${JSON.stringify(parsed)}\n`, "utf8");
			return true;
		});
	} catch {
		return false;
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
