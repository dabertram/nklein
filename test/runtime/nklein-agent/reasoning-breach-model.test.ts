import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createReasoningBreachModel,
	ReasoningBudgetBreachError,
} from "../../../src/nklein-agent/reasoning-breach-model";

/**
 * F3.36 (b): the swarm path's mid-turn reasoning-budget cut. Reasoning deltas count, visible text does not, a
 * tool call already in flight is never orphaned, and the cut is a typed abort on a derived signal.
 */
function fakeModel(events: AgentModelEvent[], onSignal?: (signal: AbortSignal | undefined) => void): AgentModel {
	return {
		stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
			onSignal?.(request.signal);
			return (async function* () {
				for (const event of events) {
					yield event;
				}
			})();
		},
	};
}
const request = { messages: [], tools: [] } as unknown as AgentModelRequest;
const reasoning = (text: string): AgentModelEvent => ({ type: "reasoning-delta", text }) as AgentModelEvent;
const text = (value: string): AgentModelEvent => ({ type: "text-delta", text: value }) as AgentModelEvent;

async function collect(
	iterable: AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await iterable) {
		events.push(event);
	}
	return events;
}

describe("reasoning breach model (F3.36 b)", () => {
	it("aborts the provider call with the typed error once the reasoning budget is breached", async () => {
		let seenSignal: AbortSignal | undefined;
		const seen: { error: ReasoningBudgetBreachError | null } = { error: null };
		// 3.5 chars ≈ 1 token: a 10-token budget breaks on the 36th reasoning char.
		const base = fakeModel([reasoning("x".repeat(20)), reasoning("x".repeat(20)), text("answer")], (signal) => {
			seenSignal = signal;
		});
		const wrapped = createReasoningBreachModel(base, {
			budgetTokens: 10,
			onBreach: (error) => {
				seen.error = error;
			},
		});
		await expect(collect(wrapped.stream(request))).rejects.toThrow(ReasoningBudgetBreachError);
		expect(seenSignal?.aborted).toBe(true);
		expect(seen.error?.spentTokens).toBe(12);
		expect(seen.error?.budgetTokens).toBe(10);
	});

	it("passes a stream through byte-identically when the reasoning stays inside the budget; text never counts", async () => {
		const events = [reasoning("short"), text("x".repeat(500)), { type: "finish", reason: "stop" } as AgentModelEvent];
		const wrapped = createReasoningBreachModel(fakeModel(events), { budgetTokens: 10 });
		expect(await collect(wrapped.stream(request))).toEqual(events);
	});

	it("never cuts once a tool-call delta appeared — a side effect in flight must not be orphaned", async () => {
		const events = [
			{ type: "tool-call-delta", name: "read_files" } as AgentModelEvent,
			reasoning("x".repeat(200)),
			{ type: "finish", reason: "stop" } as AgentModelEvent,
		];
		const wrapped = createReasoningBreachModel(fakeModel(events), { budgetTokens: 10 });
		expect(await collect(wrapped.stream(request))).toEqual(events);
	});

	it("a caller abort is forwarded as itself, never re-attributed to a breach", async () => {
		const outer = new AbortController();
		outer.abort(new Error("caller cancelled"));
		let seenSignal: AbortSignal | undefined;
		const wrapped = createReasoningBreachModel(
			fakeModel([text("a")], (signal) => (seenSignal = signal)),
			{
				budgetTokens: 10,
			},
		);
		await collect(wrapped.stream({ ...request, signal: outer.signal }));
		expect(seenSignal?.aborted).toBe(true);
		expect((seenSignal?.reason as Error | undefined)?.message).toBe("caller cancelled");
	});
});
