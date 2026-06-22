import { describe, expect, it } from "vitest";
import {
	createLocalGgufEmbeddingProvider,
	createNKleinCodeEmbeddingProviderFromSettings,
} from "../../../src/nklein-sdk/nklein-code-embeddings";
import type {
	EmbeddingModelManifest,
	EnsureEmbeddingModelResult,
} from "../../../src/nklein-sdk/nklein-embedding-model-manager";

const MANIFEST: EmbeddingModelManifest = {
	id: "test-embed",
	version: "1",
	label: "Test Embed",
	fileName: "test-embed.gguf",
	url: "https://example.invalid/test-embed.gguf",
	dimension: 4,
};

const ensureOk = async (): Promise<EnsureEmbeddingModelResult> => ({
	installed: true,
	modelPath: "/tmp/test-embed.gguf",
	downloaded: false,
	alreadyCurrent: true,
	sizeBytes: 100,
});

describe("local_gguf code-embedding provider", () => {
	it("embeds via the Python core /v1/embed and sparsifies the dense vector", async () => {
		let requestedBody: unknown;
		const fetchImpl = (async (_url: string, init?: { body?: string }) => {
			requestedBody = init?.body ? JSON.parse(init.body) : null;
			return new Response(JSON.stringify({ embeddings: [[0, 0.5, 0, -0.25]], backend: "llama_cpp" }), {
				status: 200,
			});
		}) as unknown as typeof fetch;

		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://127.0.0.1:3585",
			manifest: MANIFEST,
			fetchImpl,
			ensureModel: ensureOk,
			nThreads: 2,
		});
		expect(provider.kind).toBe("local_gguf");
		expect(provider.cacheKey).toBe("local-gguf:test-embed:1");

		const vector = await provider.embed("hello");
		// Only non-zero dims are kept.
		expect(vector.get("dim:1")).toBe(0.5);
		expect(vector.get("dim:3")).toBe(-0.25);
		expect(vector.has("dim:0")).toBe(false);
		expect(requestedBody).toMatchObject({ gguf_path: "/tmp/test-embed.gguf", n_threads: 2 });
	});

	it("ensures the model only once across multiple embeds", async () => {
		let ensureCalls = 0;
		const ensureModel = async (): Promise<EnsureEmbeddingModelResult> => {
			ensureCalls += 1;
			return ensureOk();
		};
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ embeddings: [[1]], backend: "llama_cpp" }), {
				status: 200,
			})) as unknown as typeof fetch;
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://x",
			manifest: MANIFEST,
			fetchImpl,
			ensureModel,
		});
		await provider.embed("a");
		await provider.embed("b");
		expect(ensureCalls).toBe(1);
	});

	it("degrades to a lexical vector when the sidecar fails", async () => {
		const fetchImpl = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://x",
			manifest: MANIFEST,
			fetchImpl,
			ensureModel: ensureOk,
		});
		const vector = await provider.embed("parse the config file");
		// Lexical fallback produces token-keyed entries, not dense dim: keys.
		expect([...vector.keys()].some((key) => key.startsWith("dim:"))).toBe(false);
		expect(vector.size).toBeGreaterThan(0);
	});

	it("degrades to lexical when the model download fails", async () => {
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://x",
			manifest: MANIFEST,
			fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
			ensureModel: async () => {
				throw new Error("download failed");
			},
		});
		const vector = await provider.embed("alpha beta");
		expect(vector.size).toBeGreaterThan(0);
	});
});

describe("createNKleinCodeEmbeddingProviderFromSettings local_gguf gating", () => {
	it("stays lexical when the Python core is explicitly disabled", () => {
		const provider = createNKleinCodeEmbeddingProviderFromSettings(
			{ provider: "local_gguf", model: "nomic-embed-text-v1.5", baseUrl: null },
			{ NKLEIN_CORE_PY: "0" } as NodeJS.ProcessEnv,
		);
		expect(provider.kind).toBe("local_lexical");
	});

	it("activates the dense GGUF path by default now that the Python core is opt-out", () => {
		const provider = createNKleinCodeEmbeddingProviderFromSettings(
			{ provider: "local_gguf", model: "nomic-embed-text-v1.5", baseUrl: null },
			{ NKLEIN_CORE_PY: undefined } as NodeJS.ProcessEnv,
		);
		expect(provider.kind).toBe("local_gguf");
	});

	it("uses the gguf provider when the Python core is enabled", () => {
		const provider = createNKleinCodeEmbeddingProviderFromSettings(
			{ provider: "local_gguf", model: "nomic-embed-text-v1.5", baseUrl: null },
			{ NKLEIN_CORE_PY: "1" } as NodeJS.ProcessEnv,
		);
		expect(provider.kind).toBe("local_gguf");
	});
});
