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
});
