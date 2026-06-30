import { describe, expect, it } from "vitest";

import {
	buildNKleinModelRegistryKey,
	buildSharedLocalEndpointId,
} from "../../../src/nklein-agent/nklein-model-registry-key";

describe("buildNKleinModelRegistryKey", () => {
	it("builds a provider:model:endpoint key", () => {
		expect(buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "qwen", endpoint: "ep" })).toBe(
			"lmstudio:qwen:ep",
		);
	});

	it("defaults a missing endpoint to 'default'", () => {
		expect(buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "qwen" })).toBe("lmstudio:qwen:default");
	});
});

describe("buildSharedLocalEndpointId", () => {
	it("returns endpoint#model for a local provider", () => {
		expect(
			buildSharedLocalEndpointId({ providerId: "lmstudio", modelId: "qwen", endpoint: "http://localhost:1234" }),
		).toBe("http://localhost:1234#qwen");
	});

	it("returns null for a managed-cloud provider", () => {
		expect(buildSharedLocalEndpointId({ providerId: "nklein", modelId: "m", endpoint: "http://x" })).toBeNull();
	});

	it("synthesizes a provider:default endpoint when none is given (local provider)", () => {
		expect(buildSharedLocalEndpointId({ providerId: "lmstudio", modelId: "qwen", endpoint: null })).toBe(
			"lmstudio:default#qwen",
		);
	});

	it("uses just the endpoint when the model id is blank", () => {
		expect(buildSharedLocalEndpointId({ providerId: "lmstudio", modelId: "   ", endpoint: "http://x" })).toBe(
			"http://x",
		);
	});
});
