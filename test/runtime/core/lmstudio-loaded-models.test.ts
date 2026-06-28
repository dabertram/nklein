import { describe, expect, it } from "vitest";
import {
	assertModelLoaded,
	fetchLoadedModelIds,
	lmStudioApiV0ModelsUrl,
	parseLoadedModelIds,
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

describe("assertModelLoaded", () => {
	it("passes for a loaded model and throws (naming the loaded set) for a non-loaded one", async () => {
		await expect(assertModelLoaded("http://x/v1", "loaded-a", fakeFetch(payload))).resolves.toBeUndefined();
		await expect(assertModelLoaded("http://x/v1", "ghost", fakeFetch(payload))).rejects.toThrow(
			/not loaded in LM Studio.*loaded-a, loaded-c.*does NOT load models/s,
		);
	});
});
