import { describe, expect, it } from "vitest";
import { resolveLoadedFallbackLaunchConfig } from "../../../src/trpc/runtime-api/start-task-session";

/** Fake fetch returning an `/api/v0/models` payload with the given ids all `loaded`. */
function loadedFetch(ids: string[]): typeof fetch {
	return (async () =>
		({
			ok: true,
			json: async () => ({ data: ids.map((id) => ({ id, state: "loaded" })) }),
		}) as Response) as unknown as typeof fetch;
}

// Minimal launch-config stand-in — the helper just returns whatever the resolver yields.
const cfg = (modelId: string) =>
	({
		providerId: "lmstudio",
		modelId,
		contextWindow: 40000,
		apiKey: null,
		baseUrl: "http://x/v1",
		reasoningEffort: null,
	}) as never;

describe("resolveLoadedFallbackLaunchConfig", () => {
	it("returns the first loaded NON-embedding model that resolves", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async ({ modelIdOverride }) => cfg(modelIdOverride),
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["text-embedding-nomic", "coder-14b", "general-9b"]),
		});
		expect(result?.modelId).toBe("coder-14b"); // embedding skipped, first real model wins
	});

	it("skips a loaded model whose resolve throws (e.g. context policy) and tries the next", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async ({ modelIdOverride }) => {
				if (modelIdOverride === "bad") {
					throw new Error("context policy violation");
				}
				return cfg(modelIdOverride);
			},
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["bad", "good"]),
		});
		expect(result?.modelId).toBe("good");
	});

	it("returns null when no loaded model resolves (⇒ caller re-throws the ORIGINAL error)", async () => {
		const result = await resolveLoadedFallbackLaunchConfig({
			resolveLaunchConfig: async () => {
				throw new Error("nope");
			},
			baseUrl: "http://x/v1",
			fetchImpl: loadedFetch(["a", "b"]),
		});
		expect(result).toBeNull();
	});

	it("returns null on an empty / unreachable loaded set (behaves exactly as before)", async () => {
		expect(
			await resolveLoadedFallbackLaunchConfig({
				resolveLaunchConfig: async ({ modelIdOverride }) => cfg(modelIdOverride),
				baseUrl: "http://x/v1",
				fetchImpl: loadedFetch([]),
			}),
		).toBeNull();
	});
});
