import { describe, expect, it } from "vitest";
import { CONSENT_MISMATCH, createLmStudioModelAcquisitionClient } from "../../../src/core/lmstudio-model-acquisition";
import type { LmStudioRestFetch } from "../../../src/core/lmstudio-rest-model-client";

/**
 * P25.3 phase 3 — per-model consent, bound at construction.
 *
 * The IMPORT boundary (`model-acquisition-boundary.test.ts`) is what keeps this capability away from the
 * autonomous runtime. What these tests cover is the second failure mode: a setup flow that legitimately holds an
 * acquisition client downloading something OTHER than what the operator was shown.
 */

function fakeFetch(recorder: { url?: string; body?: string }): LmStudioRestFetch {
	return async (url, init) => {
		recorder.url = url;
		recorder.body = init?.body;
		return { ok: true, status: 200, json: async () => ({ status: "downloading" }) };
	};
}

describe("createLmStudioModelAcquisitionClient", () => {
	it("downloads the model it was authorised for", async () => {
		const recorder: { url?: string; body?: string } = {};
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234/v1",
			consent: { modelKey: "qwen/qwen3-8b", approvedBytes: 4_800_000_000 },
			fetch: fakeFetch(recorder),
		});
		const result = await client.downloadModel({ model: "qwen/qwen3-8b" });
		expect(result.ok).toBe(true);
		expect(recorder.url).toBe("http://localhost:1234/api/v1/models/download");
		expect(recorder.body).toBe(JSON.stringify({ model: "qwen/qwen3-8b" }));
	});

	it("REFUSES a different model, without touching the network", async () => {
		// The failure this prevents: a setup flow that shows the operator one model and downloads another because
		// the selection changed between the prompt and the call.
		const recorder: { url?: string; body?: string } = {};
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "qwen/qwen3-8b", approvedBytes: null },
			fetch: fakeFetch(recorder),
		});
		const result = await client.downloadModel({ model: "some/other-model-70b" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error.type).toBe(CONSENT_MISMATCH);
		expect(recorder.url, "a refused download must not reach the endpoint at all").toBeUndefined();
	});

	it("exposes the consent it is bound to, so a caller can render what it is about to do", () => {
		const consent = { modelKey: "qwen/qwen3-8b", approvedBytes: 4_800_000_000 };
		expect(createLmStudioModelAcquisitionClient({ baseUrl: "http://localhost:1234", consent }).consent).toEqual(
			consent,
		);
	});

	it("normalises a /v1 base url the same way the runtime client does", async () => {
		const recorder: { url?: string; body?: string } = {};
		await createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234/v1/",
			consent: { modelKey: "m", approvedBytes: null },
			fetch: fakeFetch(recorder),
		}).downloadModel({ model: "m" });
		expect(recorder.url).toBe("http://localhost:1234/api/v1/models/download");
	});

	it("returns an ordinary error result when the endpoint rejects — never throws", async () => {
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "ghost/model", approvedBytes: null },
			fetch: async () => ({
				ok: false,
				status: 404,
				json: async () => ({ error: { type: "model_not_found", message: "no such model" } }),
			}),
		});
		const result = await client.downloadModel({ model: "ghost/model" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error.type).toBe("model_not_found");
	});

	it("survives an unreachable endpoint as a network_error result", async () => {
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "m", approvedBytes: null },
			fetch: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const result = await client.downloadModel({ model: "m" });
		expect(result.ok === false && result.error.type).toBe("network_error");
	});
});
