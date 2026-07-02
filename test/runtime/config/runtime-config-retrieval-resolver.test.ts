import { describe, expect, it } from "vitest";

import {
	DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL,
	type RuntimeRetrievalConfigFields,
	resolveRuntimeRetrievalConfig,
} from "../../../src/config/runtime-config-retrieval-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const defaults: RuntimeRetrievalConfigFields = {
	retrievalEgressEnabled: DEFAULT_RETRIEVAL_EGRESS_ENABLED,
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
			retrievalSearchBackendUrl: "http://localhost:8888",
		});
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
