import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_CHAT_BASE_URL } from "../../../src/chat/local-chat-model";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../../../src/core/local-model-endpoint";

describe("DEFAULT_LOCAL_MODEL_BASE_URL", () => {
	it("is the loopback LM Studio OpenAI-compatible endpoint", () => {
		expect(DEFAULT_LOCAL_MODEL_BASE_URL).toBe("http://127.0.0.1:1234/v1");
	});

	it("is the single source of truth the chat-context alias resolves to (guards against re-drift)", () => {
		expect(DEFAULT_LOCAL_CHAT_BASE_URL).toBe(DEFAULT_LOCAL_MODEL_BASE_URL);
	});
});
