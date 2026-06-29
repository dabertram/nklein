import { describe, expect, it } from "vitest";
import {
	assertModelLoaded,
	fetchLoadedModelIds,
	fetchLoadedModelIdsCached,
	lmStudioApiV0ModelsUrl,
	parseLoadedModelIds,
	shouldBlockUnloadedModel,
} from "../../../src/core/lmstudio-loaded-models";

const payload = {
	data: [
		{ id: "loaded-a", state: "loaded" },
		{ id: "not-loaded-b", state: "not-loaded" },
		{ id: "loaded-c", state: "loaded" },
		{ id: "", state: "loaded" }, // empty id ignored
		{ state: "loaded" }, // no id ignored
	],
};

function fakeFetch(body: unknown, ok = true): typeof fetch {
	return (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe("parseLoadedModelIds", () => {
	it("keeps only state=loaded ids, tolerant of shape", () => {
		expect(parseLoadedModelIds(payload)).toEqual(["loaded-a", "loaded-c"]);
		expect(parseLoadedModelIds(payload.data)).toEqual(["loaded-a", "loaded-c"]); // bare array
		expect(parseLoadedModelIds({})).toEqual([]);
		expect(parseLoadedModelIds(null)).toEqual([]);
	});
});

describe("lmStudioApiV0ModelsUrl", () => {
	it("maps an OpenAI /v1 base url to the enhanced /api/v0/models url", () => {
		expect(lmStudioApiV0ModelsUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/api/v0/models");
		expect(lmStudioApiV0ModelsUrl("http://127.0.0.1:1234/v1/")).toBe("http://127.0.0.1:1234/api/v0/models");
		expect(lmStudioApiV0ModelsUrl("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/api/v0/models");
	});
});

describe("fetchLoadedModelIds", () => {
	it("returns loaded ids on success, [] on failure (never throws)", async () => {
		expect(await fetchLoadedModelIds("http://x/v1", fakeFetch(payload))).toEqual(["loaded-a", "loaded-c"]);
		expect(await fetchLoadedModelIds("http://x/v1", fakeFetch(payload, false))).toEqual([]);
		const throwingFetch = (async () => {
			throw new Error("unreachable");
		}) as unknown as typeof fetch;
		expect(await fetchLoadedModelIds("http://x/v1", throwingFetch)).toEqual([]);
	});
});

describe("shouldBlockUnloadedModel", () => {
	it("blocks only a positively-non-resident model; allows when the loaded set is unknown/empty", () => {
		expect(shouldBlockUnloadedModel("ghost", ["loaded-a", "loaded-c"])).toBe(true);
		expect(shouldBlockUnloadedModel("loaded-a", ["loaded-a", "loaded-c"])).toBe(false);
		expect(shouldBlockUnloadedModel("anything", [])).toBe(false); // unknown/empty → allow (never wedge)
	});
});

describe("assertModelLoaded", () => {
	it("passes for a loaded model and throws (naming the loaded set) for a non-loaded one", async () => {
		await expect(assertModelLoaded("http://x/v1", "loaded-a", fakeFetch(payload))).resolves.toBeUndefined();
		await expect(assertModelLoaded("http://x/v1", "ghost", fakeFetch(payload))).rejects.toThrow(
			/not loaded in LM Studio.*loaded-a, loaded-c.*does NOT load models/s,
		);
	});
});

describe("fetchLoadedModelIdsCached (anti-hammering TTL cache, §4A)", () => {
	const counting = () => {
		let calls = 0;
		const fetchImpl = (async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
		const wrapped = (async (...args: unknown[]) => {
			calls += 1;
			return (fetchImpl as (...a: unknown[]) => unknown)(...args);
		}) as unknown as typeof fetch;
		return { wrapped, calls: () => calls };
	};

	it("reuses a recent fetch within the TTL window (one /v0/models hit for repeated residency checks)", async () => {
		const prev = process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "30000";
		try {
			const f = counting();
			const url = "http://127.0.0.1:9911/v1"; // unique base → no cross-test cache hit
			const a = await fetchLoadedModelIdsCached(url, f.wrapped);
			const b = await fetchLoadedModelIdsCached(url, f.wrapped);
			expect(a).toEqual(["loaded-a", "loaded-c"]);
			expect(b).toEqual(a);
			expect(f.calls()).toBe(1); // cached → only one network hit
		} finally {
			process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = prev;
		}
	});

	it("does NOT cache when the TTL is 0 (test-runner default / disabled)", async () => {
		const prev = process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "0";
		try {
			const f = counting();
			const url = "http://127.0.0.1:9912/v1";
			await fetchLoadedModelIdsCached(url, f.wrapped);
			await fetchLoadedModelIdsCached(url, f.wrapped);
			expect(f.calls()).toBe(2); // no cache → both hit
		} finally {
			process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = prev;
		}
	});
});
