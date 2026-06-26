import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverLoadedModelId } from "../../src/chat/local-chat-model";
import { LocalLlmClient } from "../../src/nklein-agent/nklein-local-llm-client";
import { type MockLlmServer, startMockLlm } from "./helpers/mock-llm";

/**
 * Verifies the §5.V mock-LLM harness speaks the exact OpenAI wire dialect the runtime's `LocalLlmClient` expects, so
 * the chat/pipeline fast-gate suites can drive a spawned server deterministically. (This is a helper self-test — it is
 * intentionally TS-coupled to the real client; the port-resilient suites only use the mock via the running server.)
 */
describe("mock-llm harness", () => {
	let mock: MockLlmServer;

	beforeEach(async () => {
		mock = await startMockLlm();
	});

	afterEach(async () => {
		await mock.close();
	});

	it("is discoverable via /models (discoverLoadedModelId finds the loaded model)", async () => {
		const modelId = await discoverLoadedModelId(mock.baseUrl);
		expect(modelId).toBe("mock-model");
	});

	it("answers a non-streaming completion with the enqueued content", async () => {
		mock.enqueue({ content: "hello from the mock" });
		const client = new LocalLlmClient({ providerId: "lmstudio", modelId: mock.modelId, baseUrl: mock.baseUrl });
		const result = await client.complete({ messages: [{ role: "user", content: "hi" }] });
		expect(result.content).toBe("hello from the mock");
		expect(result.finishReason).toBe("stop");
		expect(mock.requests).toHaveLength(1);
		expect(mock.requests[0]?.stream).toBe(false);
	});

	it("streams the enqueued content chunk-by-chunk (completeStream accumulates it)", async () => {
		mock.enqueue({ content: "streamed reply text" });
		const client = new LocalLlmClient({ providerId: "lmstudio", modelId: mock.modelId, baseUrl: mock.baseUrl });
		const chunks: string[] = [];
		const result = await client.completeStream({ messages: [{ role: "user", content: "hi" }] }, (delta) =>
			chunks.push(delta),
		);
		expect(result.content).toBe("streamed reply text");
		expect(chunks.join("")).toBe("streamed reply text");
		expect(chunks.length).toBeGreaterThan(1); // actually streamed, not one shot
		expect(mock.requests[0]?.stream).toBe(true);
	});

	it("returns scripted tool calls (completeWithTools parses name + JSON arguments)", async () => {
		mock.enqueue({ toolCalls: [{ name: "decompose_project", arguments: { slug: "demo", minimumTaskCount: 3 } }] });
		const client = new LocalLlmClient({ providerId: "lmstudio", modelId: mock.modelId, baseUrl: mock.baseUrl });
		const result = await client.completeWithTools({ messages: [{ role: "user", content: "plan it" }] }, [
			{ name: "decompose_project", description: "split a project", parameters: { type: "object" } },
		]);
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]).toMatchObject({
			name: "decompose_project",
			arguments: { slug: "demo", minimumTaskCount: 3 },
		});
		expect(result.finishReason).toBe("tool_calls");
	});

	it("FIFO-dequeues scripted replies and falls back to the default when empty", async () => {
		mock.setDefault({ content: "default reply" });
		mock.enqueue({ content: "first" });
		const client = new LocalLlmClient({ providerId: "lmstudio", modelId: mock.modelId, baseUrl: mock.baseUrl });
		const first = await client.complete({ messages: [{ role: "user", content: "a" }] });
		const second = await client.complete({ messages: [{ role: "user", content: "b" }] });
		expect(first.content).toBe("first");
		expect(second.content).toBe("default reply");
	});
});
