import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLlmfitCatalogSupplement, parseLlmfitCatalogSupplement } from "../../../src/core/llmfit-catalog-supplement";
import {
	assessModelSuitability,
	clearModelCatalogLlmfitSupplement,
	clearModelCatalogOverlay,
	lookupModelCapability,
	registerModelCatalogLlmfitSupplement,
} from "../../../src/core/model-capability-catalog";

afterEach(() => {
	clearModelCatalogOverlay();
	clearModelCatalogLlmfitSupplement();
});

const cache = {
	version: 1,
	metadata: {
		sourceUrl: "https://api.github.com/repos/AlexsJones/llmfit/contents/llmfit-core/data/hf_models.json?ref=main",
		downloadUrl: "https://raw.test/llmfit/hf_models.json",
		revision: "sha-llmfit",
	},
	models: [
		{
			name: "Acme/Acme-Coder-9B-Instruct",
			quantization: "Q4_K_M",
			recommended_ram_gb: 8,
			context_length: 32768,
			use_case: "Coding, software development",
			capabilities: ["Tool Use", "Code"],
		},
	],
};

describe("parseLlmfitCatalogSupplement", () => {
	it("turns cached llmfit rows into non-authoritative UNKNOWN capability entries", () => {
		const result = parseLlmfitCatalogSupplement(cache);

		expect(result).toMatchObject({
			revision: "sha-llmfit",
			rawModelCount: 1,
			parsedModelCount: 1,
			errors: [],
		});
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			family: "llmfit:acme-coder-9b",
			toolUse: "UNKNOWN",
			kind: "code",
			speed: undefined,
			sizeGb: 8,
			basis: "research",
			verified: false,
		});
		expect(result.entries[0].match.test("acme-coder-9b-local")).toBe(true);
		expect(result.entries[0].note).toContain("claims tool_use");
		expect(result.entries[0].note).toContain("Tool-use remains UNKNOWN");
	});

	it("skips malformed rows without rejecting the rest of the cache", () => {
		const result = parseLlmfitCatalogSupplement({
			...cache,
			models: [{ no: "name" }, ...cache.models],
		});

		expect(result.entries).toHaveLength(1);
		expect(result.errors[0]).toMatch(/model\[0\] skipped/);
	});
});

describe("llmfit catalog supplement lookup order", () => {
	it("fills a model unknown to the shipped catalog", () => {
		expect(lookupModelCapability("acme-coder-9b-local")).toBeNull();
		registerModelCatalogLlmfitSupplement(parseLlmfitCatalogSupplement(cache).entries);

		const entry = lookupModelCapability("acme-coder-9b-local");
		expect(entry?.family).toBe("llmfit:acme-coder-9b");
		expect(entry?.toolUse).toBe("UNKNOWN");
		expect(assessModelSuitability("acme-coder-9b-local").severity).toBe("warn");
	});

	it("does not override the shipped empirical catalog when llmfit claims tool_use", () => {
		const gemmaBefore = lookupModelCapability("google/gemma-3-12b-it");
		expect(gemmaBefore?.family).toBe("gemma-3");
		registerModelCatalogLlmfitSupplement(
			parseLlmfitCatalogSupplement({
				...cache,
				models: [
					{
						name: "google/gemma-3-12b-it",
						recommended_ram_gb: 12,
						context_length: 8192,
						use_case: "General purpose",
						capabilities: ["tool_use"],
					},
				],
			}).entries,
		);

		const gemmaAfter = lookupModelCapability("google/gemma-3-12b-it");
		expect(gemmaAfter?.family).toBe("gemma-3");
		expect(gemmaAfter?.toolUse).toBe("TOOL_WEAK");
	});
});

describe("loadLlmfitCatalogSupplement", () => {
	it("loads a cache file from disk", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-llmfit-supplement-"));
		try {
			const path = join(root, "llmfit-catalog-cache.json");
			await writeFile(path, `${JSON.stringify(cache)}\n`, "utf8");

			const result = await loadLlmfitCatalogSupplement(path);

			expect(result.entries).toHaveLength(1);
			expect(result.revision).toBe("sha-llmfit");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
