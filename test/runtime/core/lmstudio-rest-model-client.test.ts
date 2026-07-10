import { describe, expect, it } from "vitest";
import {
	createLmStudioRestModelClient,
	type LmStudioRestFetch,
	loadModelViaRestGuarded,
	parseLmStudioRestModel,
} from "../../../src/core/lmstudio-rest-model-client";

/** Fake fetch serving the LIVE-VERIFIED /api/v1 wire shapes (2026-07-10 probe against LM Studio :1234). */
function fakeFetch(state: {
	models: Array<{ key: string; size_bytes?: number; loaded_instances?: Array<{ instance_id: string }> }>;
	calls: Array<{ url: string; body?: unknown }>;
	failLoadWith?: { status: number; error: { type: string; message: string; code?: string } };
}): LmStudioRestFetch {
	return async (url, init) => {
		const body = init?.body ? JSON.parse(init.body) : undefined;
		state.calls.push({ url, body });
		const respond = (status: number, payload: unknown) => ({
			ok: status >= 200 && status < 300,
			status,
			json: async () => payload,
		});
		if (url.endsWith("/api/v1/models") && !init?.method) {
			return respond(200, { models: state.models });
		}
		if (url.endsWith("/api/v1/models/load")) {
			if (state.failLoadWith) {
				return respond(state.failLoadWith.status, { error: state.failLoadWith.error });
			}
			const key = (body as { model: string }).model;
			state.models = state.models.map((model) =>
				model.key === key ? { ...model, loaded_instances: [{ instance_id: key }] } : model,
			);
			return respond(200, { type: "llm", instance_id: key, load_time_seconds: 4.2, status: "loaded" });
		}
		if (url.endsWith("/api/v1/models/unload")) {
			const instanceId = (body as { instance_id: string }).instance_id;
			state.models = state.models.map((model) =>
				(model.loaded_instances ?? []).some((instance) => instance.instance_id === instanceId)
					? { ...model, loaded_instances: [] }
					: model,
			);
			return respond(200, { instance_id: instanceId });
		}
		if (url.endsWith("/api/v1/models/download")) {
			return respond(404, {
				error: { type: "model_not_found", message: `${(body as { model: string }).model} not found` },
			});
		}
		return respond(404, { error: { type: "not_found", message: "no route" } });
	};
}

const GB = 1_073_741_824;

describe("parseLmStudioRestModel", () => {
	it("parses the verified row shape and tolerates missing fields", () => {
		const model = parseLmStudioRestModel({
			type: "llm",
			key: "qwen/qwen3.6-27b",
			display_name: "Qwen3.6 27B",
			size_bytes: 17 * GB,
			loaded_instances: [{ instance_id: "qwen/qwen3.6-27b" }],
			max_context_length: 262144,
		});
		expect(model?.key).toBe("qwen/qwen3.6-27b");
		expect(model?.loadedInstanceIds).toEqual(["qwen/qwen3.6-27b"]);
		expect(model?.sizeBytes).toBe(17 * GB);
		expect(parseLmStudioRestModel({ no: "key" })).toBeNull();
	});
});

describe("createLmStudioRestModelClient", () => {
	it("lists, loads (context_length only — the verified strict schema), and unloads by instance_id", async () => {
		const state = {
			models: [{ key: "m1", size_bytes: 2 * GB }],
			calls: [] as Array<{ url: string; body?: unknown }>,
		};
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234/v1", fetch: fakeFetch(state) });

		const listed = await client.listModels();
		expect(listed.ok && listed.value[0]?.key).toBe("m1");

		const loaded = await client.loadModel({ model: "m1", contextLength: 40000 });
		expect(loaded.ok && loaded.value.instanceId).toBe("m1");
		const loadCall = state.calls.find((call) => call.url.endsWith("/models/load"));
		// The verified schema is STRICT (unknown keys rejected) — assert we send exactly the accepted params.
		expect(loadCall?.body).toEqual({ model: "m1", context_length: 40000 });
		expect(loadCall?.url).toBe("http://x:1234/api/v1/models/load"); // /v1 suffix stripped to the origin

		const unloaded = await client.unloadModel({ instanceId: "m1" });
		expect(unloaded.ok && unloaded.value.instanceId).toBe("m1");
	});

	it("returns the typed error union for API failures and never throws on network failure", async () => {
		const state = {
			models: [{ key: "m1" }],
			calls: [],
			failLoadWith: {
				status: 400,
				error: {
					type: "invalid_request",
					message: "Unrecognized key(s) in object: 'ttl'",
					code: "unrecognized_keys",
				},
			},
		};
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234", fetch: fakeFetch(state) });
		const result = await client.loadModel({ model: "m1" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_request");
			expect(result.error.code).toBe("unrecognized_keys");
		}
		const dead = createLmStudioRestModelClient({
			baseUrl: "http://x:1234",
			fetch: async () => {
				throw new Error("refused");
			},
		});
		const deadResult = await dead.listModels();
		expect(deadResult.ok).toBe(false);
		if (!deadResult.ok) {
			expect(deadResult.error.type).toBe("network_error");
		}
	});
});

describe("loadModelViaRestGuarded (decideModelLoadAction stays the governor)", () => {
	it("loads directly when headroom fits, recording the policy trail", async () => {
		const state = { models: [{ key: "target", size_bytes: 4 * GB }], calls: [] };
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234", fetch: fakeFetch(state) });
		const result = await loadModelViaRestGuarded(client, { modelKey: "target", contextLength: 40000, freeGb: 32 });
		expect(result.loaded).toBe(true);
		expect(result.actions.map((action) => action.action)).toEqual(["load"]);
	});

	it("evicts the largest NON-resident idle model first, then loads", async () => {
		const state = {
			models: [
				{ key: "target", size_bytes: 20 * GB },
				{ key: "big-idle", size_bytes: 30 * GB, loaded_instances: [{ instance_id: "big-idle" }] },
				{ key: "pinned", size_bytes: 40 * GB, loaded_instances: [{ instance_id: "pinned" }] },
			],
			calls: [] as Array<{ url: string; body?: unknown }>,
		};
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234", fetch: fakeFetch(state) });
		const result = await loadModelViaRestGuarded(client, {
			modelKey: "target",
			contextLength: 40000,
			freeGb: 10,
			residentModelKeys: ["pinned"],
		});
		expect(result.loaded).toBe(true);
		expect(result.actions.map((action) => action.action)).toEqual(["unload_first", "load"]);
		const unloadCall = state.calls.find((call) => call.url.endsWith("/models/unload"));
		expect(unloadCall?.body).toEqual({ instance_id: "big-idle" });
	});

	it("refuses (blocked) when every loaded model is resident or busy — residents are sacred", async () => {
		const state = {
			models: [
				{ key: "target", size_bytes: 20 * GB },
				{ key: "pinned", size_bytes: 30 * GB, loaded_instances: [{ instance_id: "pinned" }] },
			],
			calls: [] as Array<{ url: string; body?: unknown }>,
		};
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234", fetch: fakeFetch(state) });
		const result = await loadModelViaRestGuarded(client, {
			modelKey: "target",
			contextLength: 40000,
			freeGb: 5,
			residentModelKeys: ["pinned"],
		});
		expect(result.loaded).toBe(false);
		expect(result.actions.at(-1)?.action).toBe("blocked");
		expect(state.calls.some((call) => call.url.endsWith("/models/unload"))).toBe(false);
	});

	it("no-ops when the model is already loaded (idempotent)", async () => {
		const state = {
			models: [{ key: "target", size_bytes: 4 * GB, loaded_instances: [{ instance_id: "target" }] }],
			calls: [] as Array<{ url: string; body?: unknown }>,
		};
		const client = createLmStudioRestModelClient({ baseUrl: "http://x:1234", fetch: fakeFetch(state) });
		const result = await loadModelViaRestGuarded(client, { modelKey: "target", contextLength: 40000, freeGb: 1 });
		expect(result.loaded).toBe(true);
		expect(result.actions.map((action) => action.action)).toEqual(["noop"]);
		expect(state.calls.some((call) => call.url.endsWith("/models/load"))).toBe(false);
	});
});
