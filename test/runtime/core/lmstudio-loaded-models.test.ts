import { describe, expect, it } from "vitest";
import {
	assertModelLoaded,
	fetchLoadedModelIds,
	fetchLoadedModelIdsCached,
	fetchLoadedModelIdsStrict,
	lmStudioApiV0ModelsUrl,
	loadedModelIdsFromLmsPsModels,
	mergeLoadedModelIds,
	parseLoadedModelIds,
	shouldBlockUnloadedModel,
	targetsSameLocalModelDaemon,
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
	return (async () => ({
		ok,
		json: async () => body,
	})) as unknown as typeof fetch;
}

describe("parseLoadedModelIds", () => {
	it("keeps only state=loaded ids, tolerant of shape", () => {
		expect(parseLoadedModelIds(payload)).toEqual(["loaded-a", "loaded-c"]);
		expect(parseLoadedModelIds(payload.data)).toEqual(["loaded-a", "loaded-c"]); // bare array
		expect(parseLoadedModelIds({})).toEqual([]);
		expect(parseLoadedModelIds(null)).toEqual([]);
	});
});

describe("lms ps resident model ids", () => {
	it("adds every addressable LM-Link identity without duplicating REST ids", () => {
		const psIds = loadedModelIdsFromLmsPsModels([
			{
				identifier: "qwen2.5.1-coder-7b-instruct",
				modelKey: "mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				indexedModelIdentifier: "device-1:mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				path: "mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
				machineId: "device-1",
				isEmbedding: false,
				status: "idle",
				queued: 0,
				parallel: 1,
				trainedForToolUse: false,
				contextLength: 32768,
			},
		]);

		expect(mergeLoadedModelIds(["qwen/qwen3-coder-next"], psIds)).toEqual([
			"qwen/qwen3-coder-next",
			"qwen2.5.1-coder-7b-instruct",
			"mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
			"device-1:mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
		]);
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

describe("fetchLoadedModelIdsStrict", () => {
	it("distinguishes a reachable empty fleet from an unreachable provider for guided setup", async () => {
		await expect(fetchLoadedModelIdsStrict("http://x/v1", fakeFetch({ data: [] }))).resolves.toEqual([]);
		await expect(fetchLoadedModelIdsStrict("http://x/v1", fakeFetch(payload, false))).rejects.toThrow(
			/LM Studio model probe failed/,
		);
		const throwingFetch = (async () => {
			throw new Error("unreachable");
		}) as unknown as typeof fetch;
		await expect(fetchLoadedModelIdsStrict("http://x/v1", throwingFetch)).rejects.toThrow("unreachable");
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
		const fetchImpl = (async () => ({
			ok: true,
			json: async () => payload,
		})) as unknown as typeof fetch;
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

	it("never caches a FAILED probe (N15 soak round 6: one cached [] paused 28 healthy cards) — next call re-probes", async () => {
		const prev = process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "30000";
		try {
			let calls = 0;
			const flaky = (async () => {
				calls += 1;
				if (calls === 1) {
					throw new Error("timeout");
				}
				return { ok: true, json: async () => payload };
			}) as unknown as typeof fetch;
			const url = "http://127.0.0.1:9913/v1";
			// Failure with no prior good view: unknown ([]), and NOT written into the cache…
			expect(await fetchLoadedModelIdsCached(url, flaky)).toEqual([]);
			// …so the very next call inside the same TTL window re-probes and recovers.
			expect(await fetchLoadedModelIdsCached(url, flaky)).toEqual(["loaded-a", "loaded-c"]);
			expect(calls).toBe(2);
		} finally {
			process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = prev;
		}
	});

	it("prefers the STALE last-good view over invented-empty when a re-probe fails after TTL expiry", async () => {
		const prev = process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS;
		process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = "1";
		try {
			let calls = 0;
			const goodThenDown = (async () => {
				calls += 1;
				if (calls === 1) {
					return { ok: true, json: async () => payload };
				}
				throw new Error("timeout");
			}) as unknown as typeof fetch;
			const url = "http://127.0.0.1:9914/v1";
			expect(await fetchLoadedModelIdsCached(url, goodThenDown)).toEqual(["loaded-a", "loaded-c"]);
			await new Promise((settle) => setTimeout(settle, 5)); // let the 1ms TTL lapse
			expect(await fetchLoadedModelIdsCached(url, goodThenDown)).toEqual(["loaded-a", "loaded-c"]); // stale grace
			expect(calls).toBe(2);
		} finally {
			process.env.NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS = prev;
		}
	});
});

describe("targetsSameLocalModelDaemon (lms ps evidence scoping — N15 soak round 6)", () => {
	it("unifies loopback spellings for the same daemon", () => {
		expect(targetsSameLocalModelDaemon("http://localhost:1234/v1", "http://127.0.0.1:1234/v1")).toBe(true);
		expect(targetsSameLocalModelDaemon("http://[::1]:1234/v1", "http://127.0.0.1:1234/v1")).toBe(true);
		expect(targetsSameLocalModelDaemon("http://127.0.0.1:1234", "http://127.0.0.1:1234/v1")).toBe(true);
	});

	it("a custom endpoint (simulator, mlx-serve, remote host) is NOT the local daemon", () => {
		expect(targetsSameLocalModelDaemon("http://127.0.0.1:53620/v1", "http://127.0.0.1:1234/v1")).toBe(false);
		expect(targetsSameLocalModelDaemon("http://127.0.0.1:8455/v1", "http://127.0.0.1:1234/v1")).toBe(false);
		expect(targetsSameLocalModelDaemon("http://192.168.1.20:1234/v1", "http://127.0.0.1:1234/v1")).toBe(false);
	});

	it("unparseable URLs answer false — no identity, no borrowed evidence", () => {
		expect(targetsSameLocalModelDaemon("not a url", "http://127.0.0.1:1234/v1")).toBe(false);
		expect(targetsSameLocalModelDaemon("http://127.0.0.1:1234/v1", "")).toBe(false);
	});
});
