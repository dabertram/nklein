import { describe, expect, it, vi } from "vitest";
import {
	decideStatefulResponsesAdoption,
	probeStatefulResponses,
	StatefulResponsesCapabilityCache,
} from "../../../src/core/stateful-responses-gate";

describe("F4.45 stateful-responses gate", () => {
	it("fails closed on every uncertainty and adopts only on a verified probe", () => {
		expect(decideStatefulResponsesAdoption({ envOptIn: false, probe: null }).adopt).toBe(false);
		expect(decideStatefulResponsesAdoption({ envOptIn: true, probe: null }).adopt).toBe(false);
		expect(
			decideStatefulResponsesAdoption({ envOptIn: true, probe: { status: 404, returnedResponseId: false } }).adopt,
		).toBe(false);
		expect(
			decideStatefulResponsesAdoption({ envOptIn: true, probe: { status: 200, returnedResponseId: false } }).adopt,
		).toBe(false);
		const verified = decideStatefulResponsesAdoption({
			envOptIn: true,
			probe: { status: 200, returnedResponseId: true },
		});
		expect(verified).toMatchObject({ adopt: true });
		expect(verified.reason).toContain("verified");
	});

	it("probe maps 200+id, non-200, and network failure honestly and never throws", async () => {
		const okFetch = vi.fn(async () => new Response(JSON.stringify({ id: "resp_1" }), { status: 200 }));
		await expect(
			probeStatefulResponses("http://127.0.0.1:1234/v1", "m", okFetch as unknown as typeof fetch),
		).resolves.toEqual({
			status: 200,
			returnedResponseId: true,
		});
		expect(okFetch).toHaveBeenCalledWith(
			"http://127.0.0.1:1234/v1/responses",
			expect.objectContaining({ method: "POST" }),
		);

		const missing = vi.fn(async () => new Response("nope", { status: 404 }));
		await expect(
			probeStatefulResponses("http://127.0.0.1:1234/v1/", "m", missing as unknown as typeof fetch),
		).resolves.toEqual({
			status: 404,
			returnedResponseId: false,
		});

		const down = vi.fn(async () => {
			throw new Error("refused");
		});
		await expect(
			probeStatefulResponses("http://127.0.0.1:1234/v1", "m", down as unknown as typeof fetch),
		).resolves.toEqual({
			status: null,
			returnedResponseId: false,
		});
	});

	it("caches one successful probe per exact local endpoint/model and skips probing when opted out", async () => {
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "resp_1" }), { status: 200 }));
		const cache = new StatefulResponsesCapabilityCache(fetchImpl as unknown as typeof fetch);
		await expect(
			cache.decide({
				envOptIn: false,
				baseUrl: "http://127.0.0.1:1234/v1",
				modelId: "m",
			}),
		).resolves.toMatchObject({ adopt: false });
		for (let index = 0; index < 2; index += 1) {
			await expect(
				cache.decide({
					envOptIn: true,
					baseUrl: "http://127.0.0.1:1234/v1",
					modelId: "m",
				}),
			).resolves.toMatchObject({ adopt: true });
		}
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("refuses a non-local Responses probe before fetch", async () => {
		const fetchImpl = vi.fn();
		const cache = new StatefulResponsesCapabilityCache(fetchImpl as unknown as typeof fetch);
		await expect(
			cache.decide({ envOptIn: true, baseUrl: "https://api.openai.com/v1", modelId: "m" }),
		).resolves.toMatchObject({ adopt: false });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("does not make a transient failed probe a process-lifetime capability verdict", async () => {
		const fetchImpl = vi
			.fn()
			.mockRejectedValueOnce(new Error("busy"))
			.mockResolvedValueOnce(new Response(JSON.stringify({ id: "resp_recovered" }), { status: 200 }));
		const cache = new StatefulResponsesCapabilityCache(fetchImpl as unknown as typeof fetch);
		const input = {
			envOptIn: true,
			baseUrl: "http://127.0.0.1:1234/v1",
			modelId: "m",
		};

		await expect(cache.decide(input)).resolves.toMatchObject({ adopt: false });
		await expect(cache.decide(input)).resolves.toMatchObject({ adopt: true });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
