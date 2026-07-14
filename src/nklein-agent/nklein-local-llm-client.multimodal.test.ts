import { describe, expect, it } from "vitest";
import type { MultimodalContentPart } from "../core/chat-multimodal";
import { LocalLlmClient } from "./nklein-local-llm-client";

/**
 * F2.7b — the wire mapping: a chat message carrying multimodal `parts` must be sent to the OpenAI-compatible endpoint
 * with those parts AS the array `content` (the provider's vision format); a plain string message stays byte-identical.
 */

function clientCapturingBody(): { client: LocalLlmClient; lastBody: () => Record<string, unknown> } {
	let captured: Record<string, unknown> = {};
	const fetchImpl = (async (_url: string, init?: { body?: string }) => {
		captured = JSON.parse(init?.body ?? "{}");
		return {
			ok: true,
			status: 200,
			json: async () => ({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
			text: async () => "",
		} as unknown as Response;
	}) as unknown as typeof fetch;
	const client = new LocalLlmClient({
		providerId: "lm-studio",
		modelId: "vision-model",
		baseUrl: "http://localhost:1234",
		fetchImpl,
	});
	return { client, lastBody: () => captured };
}

describe("LocalLlmClient wire mapping (F2.7b multimodal)", () => {
	it("sends a message's `parts` as the array `content` on the wire", async () => {
		const { client, lastBody } = clientCapturingBody();
		const parts: MultimodalContentPart[] = [
			{ type: "text", text: "describe" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
		];
		await client.complete({ messages: [{ role: "user", content: "describe", parts }] });

		const messages = lastBody().messages as Array<{ role: string; content: unknown }>;
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
		expect(messages[0].content).toEqual(parts); // the array, not the plain string
	});

	it("a plain-string message is byte-identical (no `parts` field leaks to the wire)", async () => {
		const { client, lastBody } = clientCapturingBody();
		await client.complete({ messages: [{ role: "user", content: "hello" }] });

		const messages = lastBody().messages as Array<Record<string, unknown>>;
		expect(messages[0]).toEqual({ role: "user", content: "hello" });
		expect("parts" in messages[0]).toBe(false);
	});
});
