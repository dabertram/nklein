import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	resolveModelListSettings: vi.fn(async (_provider: string, settings: unknown, _catalog: unknown) => settings),
	resolveLiteLlmModelListItemId: vi.fn((item: { id?: string }, _pathname: string) => item.id ?? ""),
	toLmStudioModels: vi.fn((item: { id?: string }, _pathname: string) =>
		item.id ? [{ id: item.id, name: item.id }] : [],
	),
}));

vi.mock("../../../src/nklein-agent/nklein-model-list-settings", () => ({
	resolveModelListSettings: h.resolveModelListSettings,
}));
vi.mock("../../../src/nklein-agent/nklein-litellm-model-list", () => ({
	LITELLM_MODEL_LIST_PATHNAMES: ["/v1/models"],
	LITELLM_MODELS_RESPONSE_SCHEMA: { safeParse: (x: unknown) => ({ success: true, data: x }) },
	resolveLiteLlmModelListHeaders: () => ({}),
	resolveLiteLlmModelListItemId: h.resolveLiteLlmModelListItemId,
}));
vi.mock("../../../src/nklein-agent/nklein-provider-discovery-urls", () => ({
	normalizeLmStudioModelListBaseUrl: (u: string) => u.replace(/\/+$/, ""),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-model-parsing", () => ({ toLmStudioModels: h.toLmStudioModels }));
vi.mock("../../../src/nklein-agent/nklein-runtime-logger", () => ({
	createKanbanNKleinLogger: () => ({ log: vi.fn() }),
}));
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => ({ listSdkProviderCatalog: vi.fn() }));
vi.mock("../../../src/core/error-message", () => ({ toErrorMessage: (e: unknown, f: string) => String(e ?? f) }));

import {
	fetchLiteLlmBaseUrlModels,
	fetchLmStudioBaseUrlModels,
} from "../../../src/nklein-agent/nklein-baseurl-model-discovery";

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as never;
const notOk = (status = 404) => ({ ok: false, status, json: async () => ({}) }) as never;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	vi.clearAllMocks();
	h.resolveModelListSettings.mockImplementation(async (_p, settings) => settings);
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchLiteLlmBaseUrlModels", () => {
	it("returns [] without fetching when there is no base URL", async () => {
		expect(await fetchLiteLlmBaseUrlModels(null)).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns the de-duplicated model roster from the first successful probe", async () => {
		fetchMock.mockResolvedValue(okJson({ data: [{ id: "m1" }, { id: "m2" }, { id: "m1" }] }));
		const models = await fetchLiteLlmBaseUrlModels({ baseUrl: "http://localhost:4000/" } as never);
		expect(models).toEqual([
			{ id: "m1", name: "m1" },
			{ id: "m2", name: "m2" },
		]);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:4000/v1/models",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("returns [] when the only probe responds non-ok", async () => {
		fetchMock.mockResolvedValue(notOk());
		expect(await fetchLiteLlmBaseUrlModels({ baseUrl: "http://localhost:4000" } as never)).toEqual([]);
	});
});

describe("fetchLmStudioBaseUrlModels", () => {
	it("maps the roster through toLmStudioModels (data OR models key)", async () => {
		fetchMock.mockResolvedValue(okJson({ models: [{ id: "lm1" }] }));
		expect(await fetchLmStudioBaseUrlModels({ baseUrl: "http://localhost:1234" } as never)).toEqual([
			{ id: "lm1", name: "lm1" },
		]);
	});

	it("returns [] when the probe throws (endpoint unreachable)", async () => {
		fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
		expect(await fetchLmStudioBaseUrlModels({ baseUrl: "http://localhost:1234" } as never)).toEqual([]);
	});
});
