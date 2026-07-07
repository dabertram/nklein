import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverModelsFromEndpoint } from "../../../src/nklein-agent/nklein-provider-model-discovery";

// §5.V coverage for the user-triggered "discover models from an endpoint" probe (previously untested). It walks the
// derived candidate /models URLs, returning the first that yields a non-empty roster, attaches a bearer token when an
// api key is given, and throws a helpful error when nothing responds. fetch is mocked; the candidate-URL derivation and
// payload parsing have their own unit tests, so an explicit modelsSourceUrl pins the first probed URL here.

function jsonResponse(body: unknown, ok = true): Response {
	return { ok, json: async () => body } as unknown as Response;
}

describe("discoverModelsFromEndpoint", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the discovered roster + source url from the first responsive endpoint", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse({ data: [{ id: "model-a" }, { id: "model-b" }] }));

		const result = await discoverModelsFromEndpoint({
			baseUrl: "http://localhost:1234",
			modelsSourceUrl: "http://localhost:1234/v1/models",
		});

		expect(result.modelSourceUrl).toBe("http://localhost:1234/v1/models");
		expect(result.models.map((model) => model.id)).toEqual(expect.arrayContaining(["model-a", "model-b"]));
		expect(fetchSpy).toHaveBeenCalledWith(
			"http://localhost:1234/v1/models",
			expect.objectContaining({ method: "GET" }),
		);
	});

	it("sends a trimmed bearer auth header when an api key is provided", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [{ id: "m" }] }));

		await discoverModelsFromEndpoint({
			baseUrl: "http://endpoint",
			modelsSourceUrl: "http://endpoint/models",
			apiKey: "  secret-key  ",
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"http://endpoint/models",
			expect.objectContaining({ headers: { Authorization: "Bearer secret-key" } }),
		);
	});

	it("throws a helpful error when no candidate endpoint returns a usable roster", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, false));

		await expect(
			discoverModelsFromEndpoint({ baseUrl: "http://nope", modelsSourceUrl: "http://nope/models" }),
		).rejects.toThrow(/Could not discover models/);
	});

	it("treats a fetch rejection on every candidate as no roster found", async () => {
		vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

		await expect(
			discoverModelsFromEndpoint({ baseUrl: "http://nope", modelsSourceUrl: "http://nope/models" }),
		).rejects.toThrow(/Could not discover models/);
	});

	it("skips an endpoint that responds with an empty roster and reports failure", async () => {
		// A 200 with zero models is not a usable roster — it must not be returned as success.
		vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));

		await expect(
			discoverModelsFromEndpoint({ baseUrl: "http://empty", modelsSourceUrl: "http://empty/models" }),
		).rejects.toThrow(/Could not discover models/);
	});
});
