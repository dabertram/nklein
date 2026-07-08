import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	checkLlmfitCatalogUpdate,
	fetchRemoteLlmfitCatalogMetadata,
	loadLocalLlmfitCatalogRevision,
	pullLlmfitCatalogCache,
} from "../../../src/core/llmfit-catalog-update";

describe("llmfit catalog update check", () => {
	it("uses GitHub Contents metadata as the revision and fetches the raw catalog only to count rows", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			if (url.includes("api.github.com")) {
				return new Response(
					JSON.stringify({
						sha: "b290cb7ca31f3b4d59ecf94af6e640282915a3c7",
						size: 1234,
						download_url: "https://raw.test/llmfit/hf_models.json",
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify([{ name: "model-a" }, { name: "model-b" }]), {
				status: 200,
				headers: { etag: '"raw-etag"' },
			});
		}) as unknown as typeof fetch;

		const metadata = await fetchRemoteLlmfitCatalogMetadata({
			fetchImpl,
			now: () => 123,
		});

		expect(metadata).toMatchObject({
			sourceUrl: "https://api.github.com/repos/AlexsJones/llmfit/contents/llmfit-core/data/hf_models.json?ref=main",
			downloadUrl: "https://raw.test/llmfit/hf_models.json",
			revision: "b290cb7ca31f3b4d59ecf94af6e640282915a3c7",
			modelCount: 2,
			sizeBytes: 1234,
			fetchedAt: 123,
		});
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("can check a direct raw catalog URL using an HTTP etag revision", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify({ models: [{ name: "model-a" }] }), {
					status: 200,
					headers: { etag: '"etag-1"' },
				}),
		) as unknown as typeof fetch;

		const result = await checkLlmfitCatalogUpdate({
			sourceUrl: "https://raw.test/hf_models.json",
			fetchImpl,
			localRevision: "etag-0",
			now: () => 456,
		});

		expect(result).toMatchObject({
			action: "suggest_update",
			localRevision: "etag-0",
			remoteRevision: "etag-1",
			remoteModelCount: 1,
			checkedAt: 456,
		});
	});

	it("does not fetch when update mode is off", async () => {
		const fetchImpl = vi.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;

		const result = await checkLlmfitCatalogUpdate({
			mode: "off",
			fetchImpl,
			localRevision: "local",
		});

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result.action).toBe("noop");
		expect(result.localRevision).toBe("local");
	});

	it("returns a noop result with the fetch error instead of throwing", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 502, statusText: "Bad Gateway" }));

		const result = await checkLlmfitCatalogUpdate({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			localRevision: null,
		});

		expect(result.action).toBe("noop");
		expect(result.remoteRevision).toBeNull();
		expect(result.error).toContain("HTTP 502");
	});

	it("pulls the remote catalog into a local cache file whose revision can be checked later", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-llmfit-catalog-"));
		try {
			const cachePath = join(root, "llmfit-catalog-cache.json");
			const fetchImpl = vi.fn(async (url: string) => {
				if (url.includes("api.github.com")) {
					return new Response(
						JSON.stringify({
							sha: "sha-cache",
							size: 321,
							download_url: "https://raw.test/llmfit/hf_models.json",
						}),
						{ status: 200 },
					);
				}
				return new Response(JSON.stringify([{ name: "model-a" }, { name: "model-b" }]), { status: 200 });
			}) as unknown as typeof fetch;

			const result = await pullLlmfitCatalogCache({
				localCatalogPath: cachePath,
				fetchImpl,
				now: () => 789,
			});

			expect(result).toMatchObject({
				action: "up_to_date",
				written: true,
				cachePath,
				localRevision: "sha-cache",
				remoteRevision: "sha-cache",
				remoteModelCount: 2,
			});
			expect(await loadLocalLlmfitCatalogRevision(cachePath)).toBe("sha-cache");
			const cache = JSON.parse(await readFile(cachePath, "utf8"));
			expect(cache.metadata).toMatchObject({
				revision: "sha-cache",
				modelCount: 2,
				fetchedAt: 789,
			});
			expect(cache.models).toHaveLength(2);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
