/**
 * §5.AN LM Studio REST model management — the IN-PROCESS alternative to `lms` CLI shell-outs, wired to the
 * `/api/v1/models` surface and guarded by the same pure policy (`decideModelLoadAction`) the CLI path consults.
 *
 * Wire shapes LIVE-VERIFIED 2026-07-10 against LM Studio on :1234 (strict schemas — unknown body keys are
 * REJECTED with a typed `invalid_request`/`unrecognized_keys` error, so the accepted params below are exact):
 *
 *   GET  /api/v1/models
 *     → { models: [{ type, publisher, key, display_name, architecture, quantization: {name, bits_per_weight},
 *          size_bytes, params_string, loaded_instances: [{ id: "<key>[:N]", config: {...} }], max_context_length,
 *          format, capabilities, description }] }   (loaded_instances[].id verified live 2026-07-11 vs a LOADED model)
 *   POST /api/v1/models/load     body { model: <key>, context_length?: number }        (NO ttl/gpu keys — CLI-only levers)
 *     → { type, instance_id, load_time_seconds, status: "loaded" }
 *   POST /api/v1/models/unload   body { instance_id: <id> }
 *     → { instance_id }
 *   POST /api/v1/models/download body { model: <catalog id> }
 *     → 404 { error: { type: "model_not_found", message } } for an unknown model (endpoint exists; a real
 *       download streams — callers must treat it as long-running and opt in deliberately).
 *   Errors: { error: { type: "model_not_found" | "invalid_request" | …, message, code?, param? } }
 *
 * Injectable `fetch` (unit-testable, no live server in tests); every method returns a discriminated result and
 * never throws. The GUARDED load (`loadModelViaRestGuarded`) composes `decideModelLoadAction` over the live list
 * (residents sacred, headroom-gated, largest-idle-evicted-first) exactly like the CLI `loadModelExclusive` path —
 * the policy governor stays in charge no matter which transport performs the load.
 */

import { decideModelLoadAction, type ModelLoadAction } from "./model-load-policy";

export interface LmStudioRestModel {
	type: string;
	key: string;
	displayName: string | null;
	architecture: string | null;
	sizeBytes: number | null;
	paramsString: string | null;
	/** Live instances of this model (non-empty = loaded). */
	loadedInstanceIds: string[];
	maxContextLength: number | null;
}

export interface LmStudioRestError {
	type: string;
	message: string;
	code?: string;
	param?: string;
}

export type LmStudioRestResult<T> = { ok: true; value: T } | { ok: false; error: LmStudioRestError };

export interface LmStudioLoadResponse {
	instanceId: string;
	loadTimeSeconds: number | null;
	status: string;
}

/** Minimal fetch surface the client needs (injectable for tests). */
export type LmStudioRestFetch = (
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface LmStudioRestModelClient {
	listModels(): Promise<LmStudioRestResult<LmStudioRestModel[]>>;
	loadModel(input: { model: string; contextLength?: number }): Promise<LmStudioRestResult<LmStudioLoadResponse>>;
	unloadModel(input: { instanceId: string }): Promise<LmStudioRestResult<{ instanceId: string }>>;
	/** Long-running for real models — callers must opt in deliberately (downloads can be tens of GB). */
	downloadModel(input: { model: string }): Promise<LmStudioRestResult<{ model: string }>>;
}

const NETWORK_ERROR: LmStudioRestError = { type: "network_error", message: "LM Studio REST endpoint unreachable." };

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readError(payload: unknown, status: number): LmStudioRestError {
	const error = asRecord(asRecord(payload)?.error);
	if (!error) {
		return { type: "http_error", message: `LM Studio REST returned HTTP ${status}.` };
	}
	return {
		type: typeof error.type === "string" ? error.type : "unknown_error",
		message: typeof error.message === "string" ? error.message : `LM Studio REST returned HTTP ${status}.`,
		...(typeof error.code === "string" ? { code: error.code } : {}),
		...(typeof error.param === "string" ? { param: error.param } : {}),
	};
}

/** Parse one `/api/v1/models` row into the client shape (tolerant: missing fields become nulls, never throws). */
export function parseLmStudioRestModel(row: unknown): LmStudioRestModel | null {
	const record = asRecord(row);
	if (!record || typeof record.key !== "string") {
		return null;
	}
	const loadedInstances = Array.isArray(record.loaded_instances) ? record.loaded_instances : [];
	return {
		type: typeof record.type === "string" ? record.type : "llm",
		key: record.key,
		displayName: typeof record.display_name === "string" ? record.display_name : null,
		architecture: typeof record.architecture === "string" ? record.architecture : null,
		sizeBytes: typeof record.size_bytes === "number" ? record.size_bytes : null,
		paramsString: typeof record.params_string === "string" ? record.params_string : null,
		loadedInstanceIds: loadedInstances
			.map((instance) => {
				// LIVE shape (2026-07-11, against a LOADED model): each loaded_instances element is
				// `{ id: "<key>[:N]", config: {...} }` — the id field is `id`, NOT `instance_id`/`identifier`. The
				// 2026-07-10 probe had 0 models loaded so this element was never exercised; read `id` first, keep the
				// other spellings as defensive fallbacks.
				const id = asRecord(instance)?.id ?? asRecord(instance)?.instance_id ?? asRecord(instance)?.identifier;
				return typeof id === "string" ? id : typeof instance === "string" ? instance : null;
			})
			.filter((id): id is string => id !== null),
		maxContextLength: typeof record.max_context_length === "number" ? record.max_context_length : null,
	};
}

export function createLmStudioRestModelClient(options: {
	/** Endpoint ORIGIN (e.g. `http://localhost:1234`); any `/v1` suffix is stripped. */
	baseUrl: string;
	fetch?: LmStudioRestFetch;
}): LmStudioRestModelClient {
	const origin = options.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
	const doFetch: LmStudioRestFetch = options.fetch ?? (fetch as unknown as LmStudioRestFetch);

	async function post<T>(
		path: string,
		body: Record<string, unknown>,
		read: (payload: unknown) => T,
	): Promise<LmStudioRestResult<T>> {
		try {
			const response = await doFetch(`${origin}${path}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok || asRecord(payload)?.error !== undefined) {
				return { ok: false, error: readError(payload, response.status) };
			}
			return { ok: true, value: read(payload) };
		} catch {
			return { ok: false, error: NETWORK_ERROR };
		}
	}

	return {
		async listModels() {
			try {
				const response = await doFetch(`${origin}/api/v1/models`);
				const payload = await response.json().catch(() => null);
				if (!response.ok) {
					return { ok: false, error: readError(payload, response.status) };
				}
				const rows = asRecord(payload)?.models;
				const models = (Array.isArray(rows) ? rows : [])
					.map(parseLmStudioRestModel)
					.filter((model): model is LmStudioRestModel => model !== null);
				return { ok: true, value: models };
			} catch {
				return { ok: false, error: NETWORK_ERROR };
			}
		},
		loadModel(input) {
			return post(
				"/api/v1/models/load",
				{ model: input.model, ...(input.contextLength ? { context_length: input.contextLength } : {}) },
				(payload) => {
					const record = asRecord(payload);
					return {
						instanceId: typeof record?.instance_id === "string" ? record.instance_id : input.model,
						loadTimeSeconds: typeof record?.load_time_seconds === "number" ? record.load_time_seconds : null,
						status: typeof record?.status === "string" ? record.status : "loaded",
					};
				},
			);
		},
		unloadModel(input) {
			return post("/api/v1/models/unload", { instance_id: input.instanceId }, (payload) => ({
				instanceId:
					typeof asRecord(payload)?.instance_id === "string"
						? (asRecord(payload)?.instance_id as string)
						: input.instanceId,
			}));
		},
		downloadModel(input) {
			return post("/api/v1/models/download", { model: input.model }, () => ({ model: input.model }));
		},
	};
}

export interface GuardedRestLoadInput {
	/** The model key to load. */
	modelKey: string;
	/** Context length for the load (≥32k floor is the caller's invariant, same as the CLI path). */
	contextLength: number;
	/** Free memory budget in GB for residency (host headroom, computed by the caller). */
	freeGb: number;
	/** Operator-pinned resident model keys — never evicted. */
	residentModelKeys?: readonly string[];
	/** Model keys with in-flight work — never evicted. */
	busyModelKeys?: readonly string[];
	/** Safety bound on eviction steps before giving up (each step unloads ONE victim, then re-decides). */
	maxEvictions?: number;
}

export interface GuardedRestLoadResult {
	loaded: boolean;
	/** Every policy decision taken, in order (noop/load/unload_first/blocked) — the audit trail. */
	actions: ModelLoadAction[];
	/** Set on a transport failure (policy decisions may still explain how far it got). */
	error?: LmStudioRestError;
}

/**
 * The GUARDED in-process load: consult `decideModelLoadAction` over the live `/api/v1/models` list (residents
 * sacred, headroom-gated, largest-idle-evicted-first), perform at most `maxEvictions` policy-ordered unloads, and
 * only then load. The exact same governor as the CLI `loadModelExclusive` path — only the transport differs.
 */
export async function loadModelViaRestGuarded(
	client: LmStudioRestModelClient,
	input: GuardedRestLoadInput,
): Promise<GuardedRestLoadResult> {
	const actions: ModelLoadAction[] = [];
	const maxEvictions = input.maxEvictions ?? 2;
	// Each policy-ordered eviction RECOVERS its victim's memory — credit it so the re-decide sees the post-unload
	// headroom (the CLI path re-reads live state between steps; a caller wanting a live re-read simply re-invokes).
	let freedGb = 0;
	for (let step = 0; step <= maxEvictions; step += 1) {
		const listed = await client.listModels();
		if (!listed.ok) {
			return { loaded: false, actions, error: listed.error };
		}
		const busy = new Set(input.busyModelKeys ?? []);
		const loadedModels = listed.value.filter((model) => model.loadedInstanceIds.length > 0);
		const requested = listed.value.find((model) => model.key === input.modelKey);
		const action = decideModelLoadAction({
			requestedModelId: input.modelKey,
			requestedSizeGb: requested?.sizeBytes != null ? requested.sizeBytes / 1_073_741_824 : null,
			loaded: loadedModels.map((model) => ({
				id: model.key,
				sizeGb: model.sizeBytes != null ? model.sizeBytes / 1_073_741_824 : null,
				busy: busy.has(model.key),
			})),
			freeGb: input.freeGb + freedGb,
			residentModelIds: input.residentModelKeys ?? [],
		});
		actions.push(action);
		if (action.action === "noop") {
			return { loaded: true, actions };
		}
		if (action.action === "blocked") {
			return { loaded: false, actions };
		}
		if (action.action === "unload_first") {
			const victim = loadedModels.find((model) => model.key === action.unloadModelId);
			const instanceId = victim?.loadedInstanceIds[0] ?? action.unloadModelId;
			const unloaded = await client.unloadModel({ instanceId });
			if (!unloaded.ok) {
				return { loaded: false, actions, error: unloaded.error };
			}
			freedGb += victim?.sizeBytes != null ? victim.sizeBytes / 1_073_741_824 : 0;
			continue; // re-consult the policy with the fresh state + recovered headroom
		}
		const loadedResult = await client.loadModel({ model: input.modelKey, contextLength: input.contextLength });
		if (!loadedResult.ok) {
			return { loaded: false, actions, error: loadedResult.error };
		}
		return { loaded: true, actions };
	}
	return { loaded: false, actions };
}
