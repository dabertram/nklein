/**
 * Parse `lms ps --json` — the RICH, machine-readable view of the currently-loaded model instances (todo §5.AB per-machine
 * pools, item "tag each loaded model with its owning pool/endpoint"). Two things the REST `/api/v1/models` can't give us:
 *
 *   - `deviceIdentifier` — WHICH machine actually serves each instance. With LM Studio's LM Link, several linked
 *     machines share ONE local endpoint (e.g. `localhost:1234`), so per-ENDPOINT concurrency can't tell them apart. This
 *     is the reliable per-MACHINE key: `null` ⇒ the LOCAL host, a hex id ⇒ a linked remote (matches `lms link status`'s
 *     device identifiers). It's what lets the swarm pool concurrency per machine + offload easy cards to secondary boxes.
 *   - `status` (liveness) + `queued` (how many requests are waiting on that instance) — a free-first routing signal
 *     richer than "is a session running", straight from the server.
 *
 * PURE parser (given the CLI's stdout), so it is unit-testable without spawning `lms`; the effectful fetch reuses the
 * existing injectable {@link LmsRunner} (`lms-model-runner`). Tolerant of shape — any parse failure yields `[]`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LmsRunner } from "./lms-model-runner";
import { modelDiscoveryCacheTtlMs } from "./model-discovery-throttle";

const execFileAsync = promisify(execFile);

/**
 * A default spawn-backed {@link LmsRunner} for READ-ONLY `lms` queries (e.g. `ps --json`). Bounded + never-throws (a spawn
 * error / non-zero exit becomes `{ stdout, exitCode }`), so a missing `lms` CLI just yields an empty result upstream.
 * NOTE: read-only by intent — the guarded LOAD path (`lms-model-runner`) owns its own runner; don't route loads here.
 */
export function createDefaultLmsRunner(timeoutMs = 5_000): LmsRunner {
	return async (args) => {
		try {
			const { stdout } = await execFileAsync("lms", [...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
			return { stdout, exitCode: 0 };
		} catch (error) {
			const e = error as { stdout?: unknown; code?: unknown };
			return {
				stdout: typeof e.stdout === "string" ? e.stdout : "",
				exitCode: typeof e.code === "number" ? e.code : 1,
			};
		}
	};
}

/** The sentinel machine id for an instance served by the LOCAL host (LM Studio reports `deviceIdentifier: null`). */
export const LOCAL_MACHINE_ID = "local";

export interface LmsPsModel {
	/** The runtime identifier you INVOKE — LM Studio's per-instance alias (`identifier`). */
	identifier: string;
	/** The real publisher model key (`modelKey`) for catalog/affinity lookups; falls back to `identifier` if absent. */
	modelKey: string;
	/** WHICH machine serves this instance: {@link LOCAL_MACHINE_ID} for the local host, else the linked device's id. */
	machineId: string;
	/** `true` for an embedding model (`type === "embedding"`). */
	isEmbedding: boolean;
	/** The server-reported status (`idle` | `loading` | …) — a liveness signal. */
	status: string | null;
	/** How many requests are currently queued on this instance (a free-first routing signal); 0 when idle/unknown. */
	queued: number;
	/** LM Studio's reported per-instance parallel request slots, when present. */
	parallel: number | null;
	/** LM Studio's `trainedForToolUse`, when reported. */
	trainedForToolUse: boolean | null;
	/** The LOADED context length for this instance (not the model's max), when reported. */
	contextLength: number | null;
}

interface RawLmsPsEntry {
	type?: unknown;
	identifier?: unknown;
	modelKey?: unknown;
	deviceIdentifier?: unknown;
	status?: unknown;
	queued?: unknown;
	parallel?: unknown;
	trainedForToolUse?: unknown;
	contextLength?: unknown;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Parse `lms ps --json` stdout into {@link LmsPsModel}s. Any malformed / non-array payload yields `[]` (never throws). */
export function parseLmsPsModels(stdout: string): LmsPsModel[] {
	let payload: unknown;
	try {
		payload = JSON.parse(stdout);
	} catch {
		return [];
	}
	// `lms ps --json` emits a bare array; tolerate a `{ data: [...] }` / `{ models: [...] }` wrapper too.
	const container = payload && typeof payload === "object" ? (payload as { data?: unknown; models?: unknown }) : null;
	const entries = Array.isArray(payload)
		? payload
		: Array.isArray(container?.data)
			? container.data
			: Array.isArray(container?.models)
				? container.models
				: [];
	const models: LmsPsModel[] = [];
	for (const raw of entries) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const entry = raw as RawLmsPsEntry;
		const identifier = asString(entry.identifier);
		if (!identifier) {
			continue; // no runtime id ⇒ not addressable
		}
		const deviceId = asString(entry.deviceIdentifier);
		models.push({
			identifier,
			modelKey: asString(entry.modelKey) ?? identifier,
			machineId: deviceId ?? LOCAL_MACHINE_ID,
			isEmbedding: entry.type === "embedding",
			status: asString(entry.status) ?? null,
			queued: typeof entry.queued === "number" && Number.isFinite(entry.queued) ? entry.queued : 0,
			parallel:
				typeof entry.parallel === "number" && Number.isFinite(entry.parallel) && entry.parallel > 0
					? Math.trunc(entry.parallel)
					: null,
			trainedForToolUse: typeof entry.trainedForToolUse === "boolean" ? entry.trainedForToolUse : null,
			contextLength:
				typeof entry.contextLength === "number" && Number.isFinite(entry.contextLength)
					? entry.contextLength
					: null,
		});
	}
	return models;
}

/** Group loaded models by their owning machine — the per-machine POOL membership the swarm concurrency accounting needs. */
export function groupModelsByMachine(models: readonly LmsPsModel[]): Map<string, LmsPsModel[]> {
	const byMachine = new Map<string, LmsPsModel[]>();
	for (const model of models) {
		const list = byMachine.get(model.machineId);
		if (list) {
			list.push(model);
		} else {
			byMachine.set(model.machineId, [model]);
		}
	}
	return byMachine;
}

/** Fetch + parse the loaded instances via the injectable `lms` runner. Returns `[]` on any failure (never throws). */
export async function fetchLmsPsModels(run: LmsRunner): Promise<LmsPsModel[]> {
	try {
		const { stdout } = await run(["ps", "--json"]);
		return parseLmsPsModels(stdout);
	} catch {
		return [];
	}
}

// W0.5 (audit 2026-07-02): `lms ps --json` was spawned up to 3× per task start UNCACHED on the hot path (the
// queue-aware free-first read + the per-machine map read), and an auto-start cascade multiplies that across every
// card in a completion wave — each spawn is a full Node CLI fork. Mirror the `/api/v0/models` TTL-cache pattern
// (`fetchLoadedModelIdsCached`): one shared snapshot inside the `modelDiscoveryCacheTtlMs` window. TTL 0 (the test
// runner default) disables caching entirely, so tests and fakes see every call.
let cachedPsSnapshot: { at: number; models: LmsPsModel[] } | null = null;

/**
 * TTL-cached {@link fetchLmsPsModels} — reuses a recent `lms ps` snapshot within the shared
 * `modelDiscoveryCacheTtlMs` window so a task start (and a whole auto-start wave) pays for at most ONE subprocess.
 * NOTE: the cache is keyed globally (one `lms` CLI per host), not per-runner — pass a custom runner only in tests
 * (where the TTL is 0 and the cache is inert).
 */
export async function fetchLmsPsModelsCached(run: LmsRunner): Promise<LmsPsModel[]> {
	const ttl = modelDiscoveryCacheTtlMs();
	if (ttl <= 0) {
		return fetchLmsPsModels(run);
	}
	const now = Date.now();
	if (cachedPsSnapshot && now - cachedPsSnapshot.at <= ttl) {
		return cachedPsSnapshot.models;
	}
	const models = await fetchLmsPsModels(run);
	cachedPsSnapshot = { at: now, models };
	return models;
}
