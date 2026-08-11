import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatDriftCriticCaller } from "../../../src/nklein-agent/nklein-drift-critic-caller";

/**
 * F12.92 / P18.4b — the production drift-critic caller. Found missing 2026-08-11: NKLEIN_DRIFT_CRITIC was
 * exported on a real drain and the run recorded ZERO drift events, because no production code constructed a
 * caller (the runtime hardwired `undefined`). These pin the transport and the reasoning-model fallback.
 */
describe("createOpenAiCompatDriftCriticCaller", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(body: unknown, ok = true) {
		const fetchMock = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("posts the prompt to the endpoint's chat completions and returns the content", async () => {
		const fetchMock = stubFetch({ choices: [{ message: { content: "DRIFT: off in the weeds" } }] });
		const caller = createOpenAiCompatDriftCriticCaller({ baseUrl: "http://localhost:1234/v1", modelId: "m" });
		await expect(caller("judge this")).resolves.toBe("DRIFT: off in the weeds");
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
		expect(url).toBe("http://localhost:1234/v1/chat/completions");
		expect(JSON.parse(init.body)).toMatchObject({ model: "m", temperature: 0 });
	});

	it("falls back to reasoning_content when content is empty (reasoning models)", async () => {
		// Live-found with the §5.AB eval harness: reasoning models can burn the budget in reasoning_content and
		// return empty content — the verdict must be parsed from what the model actually said.
		stubFetch({ choices: [{ message: { content: "", reasoning_content: "Looks on-track." } }] });
		const caller = createOpenAiCompatDriftCriticCaller({ baseUrl: "http://localhost:1234", modelId: "m" });
		await expect(caller("judge this")).resolves.toBe("Looks on-track.");
	});

	it("returns null for an empty reply and throws on a failed request — never a fabricated verdict", async () => {
		stubFetch({ choices: [{ message: { content: "" } }] });
		const caller = createOpenAiCompatDriftCriticCaller({ baseUrl: "http://localhost:1234", modelId: "m" });
		await expect(caller("judge this")).resolves.toBeNull();

		stubFetch({}, false);
		await expect(caller("judge this")).rejects.toThrow(/drift critic call failed \(500\)/);
	});
});
