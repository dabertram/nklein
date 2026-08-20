import { describe, expect, it, vi } from "vitest";
import {
	CONSENT_MISMATCH,
	createLmStudioModelAcquisitionClient,
	isAutoDownloadSafeFormat,
	PUBLISHER_NOT_ALLOWED,
	UNSAFE_FORMAT_REFUSED,
} from "../../../src/core/lmstudio-model-acquisition";
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
			consent: { modelKey: "qwen/qwen3-8b", approvedBytes: 4_800_000_000, artifactFormat: "gguf" },
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
			consent: { modelKey: "qwen/qwen3-8b", approvedBytes: null, artifactFormat: "gguf" },
			fetch: fakeFetch(recorder),
		});
		const result = await client.downloadModel({ model: "some/other-model-70b" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error.type).toBe(CONSENT_MISMATCH);
		expect(recorder.url, "a refused download must not reach the endpoint at all").toBeUndefined();
	});

	it("exposes the consent it is bound to, so a caller can render what it is about to do", () => {
		const consent = { modelKey: "qwen/qwen3-8b", approvedBytes: 4_800_000_000, artifactFormat: "gguf" as const };
		expect(createLmStudioModelAcquisitionClient({ baseUrl: "http://localhost:1234", consent }).consent).toEqual(
			consent,
		);
	});

	it("normalises a /v1 base url the same way the runtime client does", async () => {
		const recorder: { url?: string; body?: string } = {};
		await createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234/v1/",
			consent: { modelKey: "m", approvedBytes: null, artifactFormat: "gguf" },
			fetch: fakeFetch(recorder),
		}).downloadModel({ model: "m" });
		expect(recorder.url).toBe("http://localhost:1234/api/v1/models/download");
	});

	it("returns an ordinary error result when the endpoint rejects — never throws", async () => {
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "ghost/model", approvedBytes: null, artifactFormat: "gguf" },
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
			consent: { modelKey: "m", approvedBytes: null, artifactFormat: "gguf" },
			fetch: async () => {
				throw new Error("ECONNREFUSED");
			},
		});
		const result = await client.downloadModel({ model: "m" });
		expect(result.ok === false && result.error.type).toBe("network_error");
	});
});

describe("P25.2b artefact-format hard rule", () => {
	it("refuses pickle-class and UNDECLARED formats regardless of matching consent — consent does not make a pickle safe", async () => {
		for (const artifactFormat of ["pickle", "unknown"] as const) {
			const fetchMock = vi.fn();
			const client = createLmStudioModelAcquisitionClient({
				baseUrl: "http://localhost:1234",
				consent: { modelKey: "evil/model", approvedBytes: null, artifactFormat },
				fetch: fetchMock as never,
			});
			const result = await client.downloadModel({ model: "evil/model" });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.type).toBe(UNSAFE_FORMAT_REFUSED);
			}
			// The refusal must bind BEFORE any network call — no request is ever made for an unsafe format.
			expect(fetchMock).not.toHaveBeenCalled();
		}
	});

	it("safe-by-design formats pass: load executes no logic for safetensors, GGUF, and MLX", () => {
		expect(isAutoDownloadSafeFormat("safetensors")).toBe(true);
		expect(isAutoDownloadSafeFormat("gguf")).toBe(true);
		expect(isAutoDownloadSafeFormat("mlx")).toBe(true);
		expect(isAutoDownloadSafeFormat("pickle")).toBe(false);
		expect(isAutoDownloadSafeFormat("unknown")).toBe(false);
	});
	it("refuses a publisher outside the allow-list, before any network call", async () => {
		const doFetch = vi.fn();
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "evil/qwen3.8-27b", approvedBytes: null, artifactFormat: "gguf", publisher: "qwem" },
			allowedPublishers: ["qwen", "lmstudio-community"],
			fetch: doFetch as never,
		});
		const result = await client.downloadModel({ model: "evil/qwen3.8-27b" });
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.error.type).toBe(PUBLISHER_NOT_ALLOWED);
		expect(doFetch).not.toHaveBeenCalled();
	});

	it("refuses an UNDECLARED publisher when an allow-list is configured (no implicit 'unknown' member)", async () => {
		const doFetch = vi.fn();
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "some/model", approvedBytes: null, artifactFormat: "gguf" },
			allowedPublishers: ["qwen"],
			fetch: doFetch as never,
		});
		const result = await client.downloadModel({ model: "some/model" });
		expect(result.ok === false && result.error.type).toBe(PUBLISHER_NOT_ALLOWED);
		expect(doFetch).not.toHaveBeenCalled();
	});

	it("admits an allow-listed publisher even when the KEY has no namespace (the common catalogue shape)", async () => {
		// Live roster 2026-08-20: only 31 of 59 keys carry a namespace, and `qwen3.8-27b-mlx` is published by
		// `lmstudio-community`, not `qwen`. A namespace-parsing allow-list would refuse this legitimate model.
		const doFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: {
				modelKey: "qwen3.8-27b-mlx",
				approvedBytes: null,
				artifactFormat: "mlx",
				publisher: "lmstudio-community",
			},
			allowedPublishers: ["lmstudio-community"],
			fetch: doFetch as never,
		});
		const result = await client.downloadModel({ model: "qwen3.8-27b-mlx" });
		expect(result.ok).toBe(true);
		expect(doFetch).toHaveBeenCalledTimes(1);
	});

	it("no allow-list configured ⇒ publisher is not consulted (today's behaviour, unchanged)", async () => {
		const doFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
		const client = createLmStudioModelAcquisitionClient({
			baseUrl: "http://localhost:1234",
			consent: { modelKey: "anyone/model", approvedBytes: null, artifactFormat: "gguf" },
			fetch: doFetch as never,
		});
		expect((await client.downloadModel({ model: "anyone/model" })).ok).toBe(true);
	});
});
