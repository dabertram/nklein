import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createRecoveryLadderModel, type RecoveryTurnSignal } from "../../../src/nklein-agent/recovery-ladder-model";

/** A fake base model: each `stream` call returns the NEXT scripted event array (last one repeats), recording requests. */
function fakeBase(scripts: AgentModelEvent[][]): { model: AgentModel; requests: AgentModelRequest[] } {
	const requests: AgentModelRequest[] = [];
	let call = 0;
	return {
		requests,
		model: {
			stream(request: AgentModelRequest) {
				requests.push(request);
				const script = scripts[Math.min(call, scripts.length - 1)] ?? [];
				call += 1;
				return (async function* () {
					for (const event of script) {
						yield event;
					}
				})();
			},
		},
	};
}

async function collect(
	iterable: AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>,
): Promise<AgentModelEvent[]> {
	const resolved = await iterable;
	const out: AgentModelEvent[] = [];
	for await (const event of resolved) {
		out.push(event);
	}
	return out;
}

// Minimal request fixture — the wrapper only reads `tools.length` + passes the request through, so the exact
// message/tool shapes don't matter here (cast past the full SDK shapes).
const req = (tools = 1): AgentModelRequest =>
	({ messages: [], tools: Array.from({ length: tools }, () => ({})) }) as unknown as AgentModelRequest;

const toolCallTurn: AgentModelEvent[] = [
	{ type: "tool-call-delta", toolName: "t0", inputText: "{}" },
	{ type: "finish", reason: "tool-calls" },
];
const stalledTurn: AgentModelEvent[] = [
	{ type: "reasoning-delta", text: "thinking..." },
	{ type: "finish", reason: "max-tokens" },
];

describe("createRecoveryLadderModel", () => {
	it("passes a turn through verbatim when shouldRecover is false (byte-identical to the bare model)", async () => {
		const { model, requests } = fakeBase([stalledTurn]);
		const wrapped = createRecoveryLadderModel({ base: model, shouldRecover: () => false, reframe: (r) => r });
		const out = await collect(wrapped.stream(req()));
		expect(out).toEqual(stalledTurn); // replayed exactly
		expect(requests).toHaveLength(1); // base called once, no re-invoke
	});

	it("recovers a stalled no-tool-call turn: re-invokes with a reframed request and REPLACES the stalled events", async () => {
		const { model, requests } = fakeBase([stalledTurn, toolCallTurn]);
		const reframe = vi.fn((request: AgentModelRequest, attempt: number) => ({
			...request,
			options: { ...request.options, retryAttempt: attempt },
		}));
		const wrapped = createRecoveryLadderModel({
			base: model,
			maxAttempts: 2,
			shouldRecover: (s) => !s.hadToolCall && s.finishReason === "max-tokens",
			reframe,
		});
		const out = await collect(wrapped.stream(req()));
		expect(out).toEqual(toolCallTurn); // the RECOVERED turn's events, not the stalled ones
		expect(requests).toHaveLength(2); // re-invoked once
		expect(reframe).toHaveBeenCalledWith(expect.anything(), 0); // attempt 0
		expect(requests[1].options?.retryAttempt).toBe(0); // the reframed request drove the retry
	});

	it("never recovers a turn that emitted a tool call", async () => {
		const { model, requests } = fakeBase([toolCallTurn, stalledTurn]);
		const shouldRecover = vi.fn((s: RecoveryTurnSignal) => !s.hadToolCall);
		const wrapped = createRecoveryLadderModel({ base: model, shouldRecover, reframe: (r) => r });
		const out = await collect(wrapped.stream(req()));
		expect(out).toEqual(toolCallTurn);
		expect(shouldRecover).toHaveBeenCalledWith(
			expect.objectContaining({ hadToolCall: true, finishReason: "tool-calls" }),
		);
		expect(requests).toHaveLength(1); // no re-invoke
	});

	it("is bounded by maxAttempts — a model that stays stalled stops re-invoking", async () => {
		// Every turn stalls; shouldRecover always true ⇒ only maxAttempts re-invokes, then the last stalled turn is yielded.
		const { model, requests } = fakeBase([stalledTurn]);
		const wrapped = createRecoveryLadderModel({
			base: model,
			maxAttempts: 2,
			shouldRecover: () => true,
			reframe: (r) => r,
		});
		const out = await collect(wrapped.stream(req()));
		expect(out).toEqual(stalledTurn); // gave up → yielded the final stalled turn
		expect(requests).toHaveLength(3); // 1 initial + 2 recovery re-invokes (maxAttempts), then stop
	});

	it("passes the finish reason + offeredTools into the signal", async () => {
		const { model } = fakeBase([stalledTurn]);
		const shouldRecover = vi.fn(() => false);
		const wrapped = createRecoveryLadderModel({ base: model, shouldRecover, reframe: (r) => r });
		await collect(wrapped.stream(req(0))); // no tools offered
		expect(shouldRecover).toHaveBeenCalledWith(
			expect.objectContaining({ finishReason: "max-tokens", hadToolCall: false, offeredTools: false, attempt: 0 }),
		);
	});

	it("maxAttempts 0 ⇒ never recovers (transparent)", async () => {
		const { model, requests } = fakeBase([stalledTurn]);
		const wrapped = createRecoveryLadderModel({
			base: model,
			maxAttempts: 0,
			shouldRecover: () => true,
			reframe: (r) => r,
		});
		expect(await collect(wrapped.stream(req()))).toEqual(stalledTurn);
		expect(requests).toHaveLength(1);
	});
});
