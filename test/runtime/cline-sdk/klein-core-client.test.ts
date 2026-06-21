import { describe, expect, it, vi } from "vitest";
import {
	createStructuredGenerator,
	KleinCoreClient,
	type StructuredGenerator,
} from "../../../src/cline-sdk/klein-core-client";

function jsonResponse(value: unknown): Response {
	return new Response(JSON.stringify({ contract_version: 1, value, backend: "proxy" }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe("KleinCoreClient.generateStructured", () => {
	it("posts the contract body to the sidecar and parses the returned value", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
		const client = new KleinCoreClient({
			sidecarUrl: "http://127.0.0.1:3585",
			target: { modelId: "qwen", baseUrl: "http://127.0.0.1:1234/v1" },
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await client.generateStructured<{ ok: boolean }>({
			messages: [{ role: "user", content: "hi" }],
			jsonSchema: { name: "out", schema: { type: "object" } },
			sampling: { temperature: 0.1, minP: 0.05 },
			parse: (value) => value as { ok: boolean },
		});
		expect(result).toEqual({ ok: true });
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://127.0.0.1:3585/v1/generate_structured");
		const body = JSON.parse(init.body as string);
		expect(body.target.model_id).toBe("qwen");
		expect(body.json_schema.name).toBe("out");
		expect(body.sampling).toMatchObject({ temperature: 0.1, min_p: 0.05 });
	});

	it("falls back to the injected generator when the sidecar errors", async () => {
		const fallback: StructuredGenerator = {
			generateStructured: vi.fn(async ({ parse }) => parse({ fromFallback: true })),
		};
		const client = new KleinCoreClient({
			sidecarUrl: "http://127.0.0.1:3585",
			target: { modelId: "qwen", baseUrl: "http://127.0.0.1:1234/v1" },
			fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
			fallback,
		});
		const result = await client.generateStructured<{ fromFallback: boolean }>({
			messages: [{ role: "user", content: "hi" }],
			jsonSchema: { name: "out", schema: {} },
			parse: (value) => value as { fromFallback: boolean },
		});
		expect(result).toEqual({ fromFallback: true });
		expect(fallback.generateStructured).toHaveBeenCalledTimes(1);
	});

	it("throws when the sidecar errors and no fallback is configured", async () => {
		const client = new KleinCoreClient({
			sidecarUrl: "http://127.0.0.1:3585",
			target: { modelId: "qwen", baseUrl: "http://127.0.0.1:1234/v1" },
			fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
		});
		await expect(
			client.generateStructured({
				messages: [{ role: "user", content: "hi" }],
				jsonSchema: { name: "out", schema: {} },
				parse: (value) => value,
			}),
		).rejects.toThrow(/generate_structured failed/);
	});
});

describe("createStructuredGenerator routing", () => {
	const fallback: StructuredGenerator = { generateStructured: async ({ parse }) => parse({}) };
	const target = { modelId: "qwen", baseUrl: "http://127.0.0.1:1234/v1" };

	it("returns the fallback unchanged when the core is disabled", () => {
		const generator = createStructuredGenerator({ fallback, target, config: { enabled: false, sidecarUrl: "x" } });
		expect(generator).toBe(fallback);
	});

	it("returns a KleinCoreClient when the core is enabled", () => {
		const generator = createStructuredGenerator({
			fallback,
			target,
			config: { enabled: true, sidecarUrl: "http://127.0.0.1:3585" },
		});
		expect(generator).toBeInstanceOf(KleinCoreClient);
	});
});
