import { describe, expect, it } from "vitest";
import { toLmStudioModels, toRuntimeProviderModel } from "../../../src/nklein-agent/nklein-provider-model-parsing";

describe("toRuntimeProviderModel (§5.V coverage)", () => {
	it("trims the name (falling back to id), includes type only when present, and drops falsy support flags", () => {
		expect(
			toRuntimeProviderModel({
				id: "m1",
				name: "  My Model  ",
				type: "  chat  ",
				contextWindow: 8000,
				supportsVision: true,
			}),
		).toEqual({ id: "m1", name: "My Model", type: "chat", contextWindow: 8000, supportsVision: true });
	});

	it("falls back to the id for a blank name and omits absent type/support flags", () => {
		expect(toRuntimeProviderModel({ id: "m2", name: "   ", contextWindow: 4096 })).toEqual({
			id: "m2",
			name: "m2",
			contextWindow: 4096,
		});
	});
});

describe("toLmStudioModels (§5.V coverage)", () => {
	it("returns a single model for a /api/v0/models item, or empty for a non-object", () => {
		expect(toLmStudioModels({ id: "m1", context_length: 8000 }, "/api/v0/models")).toEqual([
			{ id: "m1", name: "m1", contextWindow: 8000 },
		]);
		expect(toLmStudioModels("garbage", "/api/v0/models")).toEqual([]);
		expect(toLmStudioModels({ context_length: 8000 }, "/api/v0/models")).toEqual([]); // no id
	});

	it("expands loaded_instances for /api/v1/models (per-instance id + context window)", () => {
		const result = toLmStudioModels(
			{
				id: "base",
				loaded_instances: [{ id: "inst-1", config: { loaded_context_length: 16000 } }],
			},
			"/api/v1/models",
		);
		expect(result).toEqual([{ id: "inst-1", name: "base", contextWindow: 16000 }]);
	});

	it("returns empty for a /api/v1/models item with no loaded instances", () => {
		expect(toLmStudioModels({ id: "base", context_length: 8000 }, "/api/v1/models")).toEqual([]);
	});

	it("reads the window from `meta.context_length` on a plain /v1/models item (mlx-serve roster shape)", () => {
		// P17.1 breakpoint (a): mlx-serve advertises the ACTIVE serve window under `meta` even for models it has
		// not lazy-loaded yet — the probe (2026-08-04) showed the 32k admission floor blind to a 262k model
		// because this sub-object was the one place the parse never probed. Top-level keys still win.
		expect(
			toLmStudioModels(
				{ id: "Qwopus3.5-9B-Coder-MLX-4bit", state: "unloaded", meta: { context_length: 262144 } },
				"/v1/models",
			),
		).toEqual([{ id: "Qwopus3.5-9B-Coder-MLX-4bit", name: "Qwopus3.5-9B-Coder-MLX-4bit", contextWindow: 262144 }]);
		expect(
			toLmStudioModels({ id: "m", context_length: 4096, meta: { context_length: 262144 } }, "/v1/models"),
		).toEqual([{ id: "m", name: "m", contextWindow: 4096 }]);
		// A meta object without a numeric window stays windowless rather than inventing one.
		expect(toLmStudioModels({ id: "m2", meta: { quantization: "4-bit" } }, "/v1/models")).toEqual([
			{ id: "m2", name: "m2" },
		]);
	});
});
