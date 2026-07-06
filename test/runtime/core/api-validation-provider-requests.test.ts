import { describe, expect, it } from "vitest";
import {
	parseDirectoryListRequest,
	parseNKleinAccountSwitchRequest,
	parseNKleinModelMaxConcurrentRequestsRequest,
	parseNKleinModelRegistryRemoveRequest,
	parseNKleinProviderModelsRequest,
} from "../../../src/core/api-validation";

// §5.V — provider/model tRPC parsers: the ones with post-schema logic trim + reject blank (stricter than the schema's
// min(1), which whitespace satisfies) and normalize endpoint→null; the two schema-passthroughs lock their required/optional shape.

describe("parseNKleinProviderModelsRequest (§5.V coverage)", () => {
	it("trims providerId and rejects blank", () => {
		expect(parseNKleinProviderModelsRequest({ providerId: "  lmstudio  " })).toEqual({ providerId: "lmstudio" });
		expect(() => parseNKleinProviderModelsRequest({ providerId: "   " })).toThrow(/Provider ID cannot be empty/);
	});
});

describe("parseNKleinModelRegistryRemoveRequest (§5.V coverage)", () => {
	it("trims key and rejects whitespace-only (stricter than schema min(1))", () => {
		expect(parseNKleinModelRegistryRemoveRequest({ key: "  a::b  " })).toEqual({ key: "a::b" });
		expect(() => parseNKleinModelRegistryRemoveRequest({ key: "   " })).toThrow(/Model registry key cannot be empty/);
	});
});

describe("parseNKleinModelMaxConcurrentRequestsRequest (§5.V coverage)", () => {
	it("trims provider/model, normalizes endpoint, passes the limit through", () => {
		expect(
			parseNKleinModelMaxConcurrentRequestsRequest({
				providerId: "  p  ",
				modelId: "  m  ",
				endpoint: "  http://x  ",
				maxConcurrentRequests: 4,
			}),
		).toEqual({ providerId: "p", modelId: "m", endpoint: "http://x", maxConcurrentRequests: 4 });
	});

	it("normalizes a blank/omitted endpoint to null and allows a null limit (clear override)", () => {
		expect(
			parseNKleinModelMaxConcurrentRequestsRequest({ providerId: "p", modelId: "m", maxConcurrentRequests: null }),
		).toEqual({ providerId: "p", modelId: "m", endpoint: null, maxConcurrentRequests: null });
	});

	it("rejects a whitespace-only providerId / modelId", () => {
		expect(() =>
			parseNKleinModelMaxConcurrentRequestsRequest({ providerId: "  ", modelId: "m", maxConcurrentRequests: null }),
		).toThrow(/Provider ID cannot be empty/);
		expect(() =>
			parseNKleinModelMaxConcurrentRequestsRequest({ providerId: "p", modelId: "  ", maxConcurrentRequests: null }),
		).toThrow(/Model ID cannot be empty/);
	});
});

describe("parseDirectoryListRequest (§5.V coverage)", () => {
	it("passes a path through and treats it as optional", () => {
		expect(parseDirectoryListRequest({ path: "/repo" })).toEqual({ path: "/repo" });
		expect(parseDirectoryListRequest({})).toEqual({ path: undefined });
	});
});

describe("parseNKleinAccountSwitchRequest (§5.V coverage)", () => {
	it("accepts an organization id or an explicit null, but requires the field", () => {
		expect(parseNKleinAccountSwitchRequest({ organizationId: "org-1" })).toEqual({ organizationId: "org-1" });
		expect(parseNKleinAccountSwitchRequest({ organizationId: null })).toEqual({ organizationId: null });
		expect(() => parseNKleinAccountSwitchRequest({})).toThrow();
	});
});
