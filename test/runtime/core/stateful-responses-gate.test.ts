import { describe, expect, it, vi } from "vitest";
import { decideStatefulResponsesAdoption, probeStatefulResponses } from "../../../src/core/stateful-responses-gate";

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
		await expect(probeStatefulResponses("http://h/v1", "m", okFetch as unknown as typeof fetch)).resolves.toEqual({
			status: 200,
			returnedResponseId: true,
		});
		expect(okFetch).toHaveBeenCalledWith("http://h/v1/responses", expect.objectContaining({ method: "POST" }));

		const missing = vi.fn(async () => new Response("nope", { status: 404 }));
		await expect(probeStatefulResponses("http://h/v1/", "m", missing as unknown as typeof fetch)).resolves.toEqual({
			status: 404,
			returnedResponseId: false,
		});

		const down = vi.fn(async () => {
			throw new Error("refused");
		});
		await expect(probeStatefulResponses("http://h/v1", "m", down as unknown as typeof fetch)).resolves.toEqual({
			status: null,
			returnedResponseId: false,
		});
	});
});
