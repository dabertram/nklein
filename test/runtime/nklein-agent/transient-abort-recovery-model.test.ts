import { AgentRuntime } from "@cline/agents";
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createTransientAbortRecoveryModel,
	TRANSIENT_MODEL_CALL_MAX_RETRIES,
} from "../../../src/nklein-agent/transient-abort-recovery-model";

type StreamScript = readonly AgentModelEvent[] | Error;

function scriptedBase(scripts: readonly StreamScript[]): {
	model: AgentModel;
	calls: () => number;
	requests: AgentModelRequest[];
} {
	let callCount = 0;
	const requests: AgentModelRequest[] = [];
	return {
		calls: () => callCount,
		requests,
		model: {
			stream(input) {
				requests.push(input);
				const script = scripts[Math.min(callCount, scripts.length - 1)] ?? [];
				callCount += 1;
				return (async function* (): AsyncGenerator<AgentModelEvent> {
					if (script instanceof Error) {
						throw script;
					}
					for (const event of script) {
						yield event;
					}
				})();
			},
		},
	};
}

function request(signal?: AbortSignal): AgentModelRequest {
	return { messages: [], tools: [], ...(signal ? { signal } : {}) };
}

async function collect(model: AgentModel, input: AgentModelRequest): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await model.stream(input)) {
		events.push(event);
	}
	return events;
}

describe("createTransientAbortRecoveryModel", () => {
	it("lets the real SDK agent runtime persist one recovered assistant turn instead of an interrupted partial", async () => {
		const base = scriptedBase([
			[
				{ type: "text-delta", text: "discarded partial" },
				{ type: "finish", reason: "aborted", error: "provider runtime aborted" },
			],
			[
				{ type: "text-delta", text: "recovered answer" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const runtime = new AgentRuntime({ model: createTransientAbortRecoveryModel(base.model) });

		const result = await runtime.run("Do the task");

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("recovered answer");
		expect(result.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
		expect(JSON.stringify(result.messages)).not.toContain("discarded partial");
		expect(base.calls()).toBe(2);
	});

	it("replaces every buffered event from an aborted attempt with the successful retry", async () => {
		const failed: AgentModelEvent[] = [
			{ type: "reasoning-delta", text: "discarded reasoning" },
			{ type: "text-delta", text: "discarded partial" },
			{ type: "usage", usage: { outputTokens: 7 } },
			{ type: "finish", reason: "aborted", error: "runtime aborted" },
		];
		const recovered: AgentModelEvent[] = [
			{ type: "text-delta", text: "ok" },
			{ type: "finish", reason: "stop" },
		];
		const base = scriptedBase([failed, recovered]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request())).toEqual(recovered);
		expect(base.calls()).toBe(2);
		expect(
			base.requests.every(
				(input) => (input.options?.metadata as Record<string, unknown> | undefined)?.nkleinProviderMaxRetries === 0,
			),
		).toBe(true);
	});

	it("reports buffered token liveness without exposing discarded token content", async () => {
		let bufferedTokens = 0;
		const base = scriptedBase([
			[
				{ type: "reasoning-delta", text: "hidden thought" },
				{ type: "finish", reason: "aborted" },
			],
			[
				{ type: "text-delta", text: "visible answer" },
				{ type: "finish", reason: "stop" },
			],
		]);
		const model = createTransientAbortRecoveryModel(base.model, {
			onBufferedToken: () => {
				bufferedTokens += 1;
			},
		});

		expect(await collect(model, request())).toEqual([
			{ type: "text-delta", text: "visible answer" },
			{ type: "finish", reason: "stop" },
		]);
		expect(bufferedTokens).toBe(2);
	});

	it("never retries an abort owned by the outer request signal", async () => {
		const controller = new AbortController();
		controller.abort("user cancelled");
		const aborted: AgentModelEvent[] = [
			{ type: "text-delta", text: "partial once" },
			{ type: "finish", reason: "aborted" },
		];
		const base = scriptedBase([aborted, [{ type: "text-delta", text: "must not run" }]]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request(controller.signal))).toEqual(aborted);
		expect(base.calls()).toBe(1);
	});

	it("never retries after a tool call because replay could duplicate a side effect", async () => {
		const toolAbort: AgentModelEvent[] = [
			{ type: "tool-call-delta", toolCallId: "call-1", toolName: "write_file", inputText: "{}" },
			{ type: "finish", reason: "aborted" },
		];
		const base = scriptedBase([toolAbort, [{ type: "finish", reason: "stop" }]]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request())).toEqual(toolAbort);
		expect(base.calls()).toBe(1);
	});

	it("bounds repeated aborts and exposes only the final attempt", async () => {
		const first: AgentModelEvent[] = [
			{ type: "text-delta", text: "first" },
			{ type: "finish", reason: "aborted" },
		];
		const second: AgentModelEvent[] = [
			{ type: "text-delta", text: "second" },
			{ type: "finish", reason: "aborted" },
		];
		const final: AgentModelEvent[] = [
			{ type: "text-delta", text: "final once" },
			{ type: "finish", reason: "aborted" },
		];
		const base = scriptedBase([first, second, final]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request())).toEqual(final);
		expect(base.calls()).toBe(TRANSIENT_MODEL_CALL_MAX_RETRIES + 1);
	});

	it("recovers a thrown transient stream failure before exposing buffered output", async () => {
		const recovered: AgentModelEvent[] = [
			{ type: "text-delta", text: "recovered" },
			{ type: "finish", reason: "stop" },
		];
		const base = scriptedBase([new Error("fetch failed (UND_ERR_SOCKET)"), recovered]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request())).toEqual(recovered);
		expect(base.calls()).toBe(2);
	});

	it("retries a transient finish:error emitted for a mid-stream provider failure", async () => {
		const base = scriptedBase([
			[
				{ type: "text-delta", text: "discard me" },
				{ type: "finish", reason: "error", error: "fetch failed: connection reset" },
			],
			[
				{ type: "text-delta", text: "stable" },
				{ type: "finish", reason: "stop" },
			],
		]);

		expect(await collect(createTransientAbortRecoveryModel(base.model), request())).toEqual([
			{ type: "text-delta", text: "stable" },
			{ type: "finish", reason: "stop" },
		]);
		expect(base.calls()).toBe(2);
	});
});
