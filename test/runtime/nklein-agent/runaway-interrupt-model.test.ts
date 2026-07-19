import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createRunawayInterruptModel,
	RunawayGenerationInterruptError,
} from "../../../src/nklein-agent/runaway-interrupt-model";

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

function textDelta(text: string): AgentModelEvent {
	return { type: "text-delta", text } as AgentModelEvent;
}

async function collect(
	iterable: AsyncIterable<AgentModelEvent> | Promise<AsyncIterable<AgentModelEvent>>,
): Promise<AgentModelEvent[]> {
	const events: AgentModelEvent[] = [];
	for await (const event of await iterable) {
		events.push(event);
	}
	return events;
}

describe("runaway interrupt model (F3.5 interrupt-safely)", () => {
	it("aborts a degenerate stream with the typed error and cancels the derived signal", async () => {
		let seenSignal: AbortSignal | undefined;
		const base = fakeModel([textDelta("loop "), textDelta("loop "), textDelta("loop ")], (signal) => {
			seenSignal = signal;
		});
		const wrapped = createRunawayInterruptModel(base, {
			sampleIntervalChars: 10,
			detect: (text) =>
				text.length >= 10 ? { runaway: true, reason: "repetition" as const, detail: "loop×N" } : { runaway: false },
		});
		await expect(collect(wrapped.stream(request))).rejects.toThrow(RunawayGenerationInterruptError);
		expect(seenSignal?.aborted).toBe(true);
	});

	it("passes a clean stream through byte-identically and fires no interrupt", async () => {
		const events = [
			textDelta("a healthy "),
			textDelta("answer"),
			{ type: "finish", reason: "stop" } as AgentModelEvent,
		];
		let interrupted = false;
		const wrapped = createRunawayInterruptModel(fakeModel(events), {
			sampleIntervalChars: 4,
			detect: () => ({ runaway: false }),
			onInterrupt: () => {
				interrupted = true;
			},
		});
		expect(await collect(wrapped.stream(request))).toEqual(events);
		expect(interrupted).toBe(false);
	});

	it("never interrupts once a tool-call delta appeared (side effects must not be orphaned)", async () => {
		const events = [
			{ type: "tool-call-delta", name: "read_files" } as AgentModelEvent,
			textDelta("loop loop loop loop loop "),
			{ type: "finish", reason: "stop" } as AgentModelEvent,
		];
		const wrapped = createRunawayInterruptModel(fakeModel(events), {
			sampleIntervalChars: 5,
			detect: () => ({ runaway: true, reason: "repetition" as const }),
		});
		expect(await collect(wrapped.stream(request))).toEqual(events);
	});

	it("chains the caller's abort into the derived signal (caller control is never re-attributed)", async () => {
		const outer = new AbortController();
		let seenSignal: AbortSignal | undefined;
		const wrapped = createRunawayInterruptModel(
			fakeModel([textDelta("hi"), textDelta("there")], (signal) => {
				seenSignal = signal;
			}),
			{ detect: () => ({ runaway: false }) },
		);
		const iterable = await wrapped.stream({ ...request, signal: outer.signal } as AgentModelRequest);
		const iterator = iterable[Symbol.asyncIterator]();
		await iterator.next();
		expect(seenSignal).toBeDefined();
		expect(seenSignal?.aborted).toBe(false);
		outer.abort();
		expect(seenSignal?.aborted).toBe(true);
		await iterator.return?.(undefined);
	});
});
