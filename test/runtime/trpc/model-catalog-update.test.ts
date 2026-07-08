import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LLMFIT_CATALOG_METADATA_URL } from "../../../src/core/llmfit-catalog-update";
import {
	handleCheckLlmfitCatalogUpdate,
	handlePullLlmfitCatalogUpdate,
} from "../../../src/trpc/runtime-api/model-catalog-update";

describe("handleCheckLlmfitCatalogUpdate", () => {
	it("returns an unavailable status when the runtime disables live checks", async () => {
		const result = await handleCheckLlmfitCatalogUpdate({
			checkCatalogUpdate: null,
			now: () => 100,
		});

		expect(result).toMatchObject({
			mode: "notify",
			action: "noop",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			checkedAt: 100,
		});
		expect(result.remoteRevision).toBeNull();
	});

	it("delegates to the live checker with notify mode and the runtime home path", async () => {
		const checkCatalogUpdate = vi.fn(async () => ({
			mode: "notify" as const,
			action: "suggest_update" as const,
			reason: "A catalog is available.",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			downloadUrl: "https://raw.test/hf_models.json",
			localRevision: null,
			remoteRevision: "sha-1",
			remoteModelCount: 2,
			remoteSizeBytes: 20,
			checkedAt: 200,
		}));

		const result = await handleCheckLlmfitCatalogUpdate({
			checkCatalogUpdate,
			homePath: "/tmp/nklein-home",
		});

		expect(checkCatalogUpdate).toHaveBeenCalledWith({ mode: "notify", homePath: "/tmp/nklein-home" });
		expect(result.action).toBe("suggest_update");
		expect(result.remoteModelCount).toBe(2);
	});

	it("returns an unavailable pull status when the runtime disables live pulls", async () => {
		const result = await handlePullLlmfitCatalogUpdate({
			pullCatalogUpdate: null,
			now: () => 300,
		});

		expect(result).toMatchObject({
			mode: "notify",
			action: "noop",
			written: false,
			cachePath: null,
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			checkedAt: 300,
		});
	});

	it("delegates catalog pulls with notify mode and the runtime home path", async () => {
		const pullCatalogUpdate = vi.fn(async () => ({
			mode: "notify" as const,
			action: "up_to_date" as const,
			reason: "Local cache updated.",
			sourceUrl: DEFAULT_LLMFIT_CATALOG_METADATA_URL,
			downloadUrl: "https://raw.test/hf_models.json",
			localRevision: "sha-2",
			remoteRevision: "sha-2",
			remoteModelCount: 3,
			remoteSizeBytes: 30,
			checkedAt: 400,
			cachePath: "/tmp/nklein-home/.nklein/nklein/llmfit-catalog-cache.json",
			written: true,
		}));

		const result = await handlePullLlmfitCatalogUpdate({
			pullCatalogUpdate,
			homePath: "/tmp/nklein-home",
		});

		expect(pullCatalogUpdate).toHaveBeenCalledWith({ mode: "notify", homePath: "/tmp/nklein-home" });
		expect(result.written).toBe(true);
		expect(result.remoteModelCount).toBe(3);
	});
});
