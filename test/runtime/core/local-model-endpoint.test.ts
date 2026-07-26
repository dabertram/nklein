import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_CHAT_BASE_URL } from "../../../src/chat/local-chat-model";
import { DEFAULT_LOCAL_MODEL_BASE_URL, resolveDefaultLocalModelBaseUrl } from "../../../src/core/local-model-endpoint";

describe("DEFAULT_LOCAL_MODEL_BASE_URL", () => {
	it("is the loopback LM Studio OpenAI-compatible endpoint", () => {
		expect(DEFAULT_LOCAL_MODEL_BASE_URL).toBe("http://127.0.0.1:1234/v1");
	});

	it("is the single source of truth the chat-context alias resolves to (guards against re-drift)", () => {
		expect(DEFAULT_LOCAL_CHAT_BASE_URL).toBe(DEFAULT_LOCAL_MODEL_BASE_URL);
	});
});

describe("resolveDefaultLocalModelBaseUrl (hermeticity-aware default)", () => {
	const original = process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL;
	afterEach(() => {
		if (original === undefined) {
			delete process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL;
		} else {
			process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL = original;
		}
	});

	it("returns the production default when no hermetic gateway is exported", () => {
		delete process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL;
		expect(resolveDefaultLocalModelBaseUrl()).toBe(DEFAULT_LOCAL_MODEL_BASE_URL);
	});

	it("returns the hermetic gateway when a simulated/nightly runtime exports it", () => {
		// The leak this closes: a sim cell's reviewer resolution fell back to the REAL gateway and picked the
		// real loaded model (`loaded_fallback`) from inside a supposedly hermetic run.
		process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL = "http://127.0.0.1:54999/v1";
		expect(resolveDefaultLocalModelBaseUrl()).toBe("http://127.0.0.1:54999/v1");
	});

	it("ignores a blank export rather than resolving to an empty base URL", () => {
		process.env.NKLEIN_NIGHTLY_MODEL_GATEWAY_URL = "   ";
		expect(resolveDefaultLocalModelBaseUrl()).toBe(DEFAULT_LOCAL_MODEL_BASE_URL);
	});
});
