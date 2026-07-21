import { describe, expect, it } from "vitest";

import {
	DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	DEFAULT_RETRIEVAL_PROVIDER_MODE,
	DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL,
	effectiveRetrievalSearchBackendUrl,
	type RuntimeRetrievalConfigFields,
	resolveRuntimeRetrievalConfig,
} from "../../../src/config/runtime-config-retrieval-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const defaults: RuntimeRetrievalConfigFields = {
	retrievalEgressEnabled: DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	retrievalProviderMode: DEFAULT_RETRIEVAL_PROVIDER_MODE,
	retrievalSearchBackendUrl: DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL,
};

const config = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeRetrievalConfig", () => {
	it("falls back to every default for a null config (egress off, no backend)", () => {
		expect(resolveRuntimeRetrievalConfig(null)).toEqual(defaults);
		expect(DEFAULT_RETRIEVAL_EGRESS_ENABLED).toBe(false);
		expect(DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL).toBeNull();
	});

	it("reads valid configured values", () => {
		expect(
			resolveRuntimeRetrievalConfig(
				config({
					retrievalEgressEnabled: true,
					retrievalSearchBackendUrl: "http://localhost:8888",
				}),
			),
		).toEqual({
			retrievalEgressEnabled: true,
			retrievalProviderMode: "searxng_url",
			retrievalSearchBackendUrl: "http://localhost:8888",
		});
	});

	it("resolves none, user URL, and managed-local modes explicitly", () => {
		expect(effectiveRetrievalSearchBackendUrl({ providerMode: "none", searchBackendUrl: "http://old" })).toBeNull();
		expect(
			effectiveRetrievalSearchBackendUrl({ providerMode: "searxng_url", searchBackendUrl: " http://search:8080 " }),
		).toBe("http://search:8080");
		expect(effectiveRetrievalSearchBackendUrl({ providerMode: "managed_local" })).toBe("http://127.0.0.1:18888");
	});

	it("fails closed: only a literal boolean true enables egress", () => {
		for (const value of ["true", 1, "yes", {}, [], null, undefined, 0, "false"]) {
			const result = resolveRuntimeRetrievalConfig(config({ retrievalEgressEnabled: value as unknown as boolean }));
			expect(result.retrievalEgressEnabled).toBe(false);
		}
		expect(resolveRuntimeRetrievalConfig(config({ retrievalEgressEnabled: true })).retrievalEgressEnabled).toBe(true);
	});

	it("trims the search backend URL and normalizes empty/whitespace/non-string to null", () => {
		expect(
			resolveRuntimeRetrievalConfig(config({ retrievalSearchBackendUrl: "  http://localhost:8888  " }))
				.retrievalSearchBackendUrl,
		).toBe("http://localhost:8888");
		for (const value of ["", "   ", null, undefined, 42, {}]) {
			const result = resolveRuntimeRetrievalConfig(
				config({ retrievalSearchBackendUrl: value as unknown as string }),
			);
			expect(result.retrievalSearchBackendUrl).toBeNull();
		}
	});
});
