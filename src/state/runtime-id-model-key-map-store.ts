import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { learnRuntimeIdModelKeyMap, type RuntimeIdToModelKeyMap } from "../core/stable-model-identity";

/**
 * §5.BG (David 2026-07-07 decision) — persistence for the `runtimeId → stable modelKey` map. Learned from live
 * descriptors and persisted so a COLD model (a config/role candidate not currently loaded) still resolves to its stable
 * key, giving the telemetry/routing keyspace ONE uniform stable identity. The pure learn/resolve logic lives in
 * `stable-model-identity.ts`; this owns the JSON file (runtime home) + a debounced write.
 *
 * Tolerant, best-effort (never throws on load): a missing or corrupt file is an empty map, and non-string entries are
 * dropped — a bad file can't wedge routing, it just re-learns from live descriptors.
 */

export function defaultRuntimeIdModelKeyMapPath(home: string): string {
	return join(resolveNkleinRuntimeHomePath(home), "runtime-id-model-key-map.json");
}

/** Load the persisted map (empty on missing/corrupt/garbage; only string→string entries survive). Never throws. */
export async function loadRuntimeIdModelKeyMap(path: string): Promise<RuntimeIdToModelKeyMap> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [runtimeId, modelKey] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof modelKey === "string" && runtimeId.trim() && modelKey.trim()) {
			out[runtimeId] = modelKey;
		}
	}
	return out;
}

/** Persist the map (pretty JSON, creating the runtime-home dir). Best-effort — a write failure is swallowed. */
export async function saveRuntimeIdModelKeyMap(path: string, map: RuntimeIdToModelKeyMap): Promise<void> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, `${JSON.stringify(map, null, 2)}\n`, "utf8");
	} catch {
		// best-effort: losing a learn-refresh just means re-learning from the next live descriptor set.
	}
}

/**
 * A tiny in-memory holder around the persisted map, so the hot routing path reads it synchronously (`current()`) and
 * learns from each fresh descriptor set (`learn(...)`) with a DEBOUNCED persist. Initialize once at server startup.
 * Learning is a no-op when the descriptor set adds nothing (byte-identical map ⇒ no write scheduled).
 */
export class RuntimeIdModelKeyMapStore {
	private map: RuntimeIdToModelKeyMap = {};
	private persistTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly path: string,
		private readonly persistDebounceMs = 500,
	) {}

	async load(): Promise<void> {
		this.map = await loadRuntimeIdModelKeyMap(this.path);
	}

	current(): RuntimeIdToModelKeyMap {
		return this.map;
	}

	/** Merge a fresh live descriptor set into the map; schedules a debounced persist only when something changed. */
	learn(descriptors: readonly { runtimeId: string; modelKey: string }[]): void {
		const next = learnRuntimeIdModelKeyMap(this.map, descriptors);
		if (next === this.map) {
			return;
		}
		// `learnRuntimeIdModelKeyMap` always returns a fresh object; compare content so a no-op set doesn't churn the file.
		const changed =
			Object.keys(next).length !== Object.keys(this.map).length ||
			Object.entries(next).some(([id, key]) => this.map[id] !== key);
		this.map = next;
		if (changed) {
			this.schedulePersist();
		}
	}

	private schedulePersist(): void {
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			void saveRuntimeIdModelKeyMap(this.path, this.map);
		}, this.persistDebounceMs);
		this.persistTimer.unref?.();
	}
}

/**
 * Process-wide singleton so the hot routing path can learn/read the map without threading the store through every deps
 * object. Initialized once at server startup; the accessors are inert (empty map / no-op learn) until then, so a caller
 * or test that never initializes is unaffected.
 */
let sharedStore: RuntimeIdModelKeyMapStore | null = null;

/** Initialize + load the shared store at server startup. Safe to call again (re-loads). */
export async function initSharedRuntimeIdModelKeyMap(path: string): Promise<void> {
	sharedStore = new RuntimeIdModelKeyMapStore(path);
	await sharedStore.load();
}

/** The current shared map (empty when uninitialized) — read synchronously on the hot path. */
export function sharedRuntimeIdModelKeyMap(): RuntimeIdToModelKeyMap {
	return sharedStore?.current() ?? {};
}

/** Learn from a fresh live descriptor set into the shared store (no-op when uninitialized). */
export function learnSharedLoadedDescriptors(descriptors: readonly { runtimeId: string; modelKey: string }[]): void {
	sharedStore?.learn(descriptors);
}

/**
 * Resolve a runtime model id → its STABLE routing key via the shared persisted map (a cold model resolves from what was
 * learned when it was last loaded); falls back to the runtime id itself when unknown. The uniform resolver the §5.BG
 * routing flip keys evidence/residency by — using it at the ledger WRITE, ledger READ, and residency sites guarantees
 * they always agree (map hit ⇒ all stable; miss ⇒ all runtime), so there is no mismatch/double-start by construction.
 */
export function resolveStableRoutingModelId(runtimeModelId: string): string {
	return sharedRuntimeIdModelKeyMap()[runtimeModelId]?.trim() || runtimeModelId;
}

/** Test-only: drop the shared store so a test starts from a clean, uninitialized state. */
export function resetSharedRuntimeIdModelKeyMapForTest(): void {
	sharedStore = null;
}
