import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { afterAll, describe, expect, it } from "vitest";
import { createSessionRequestLogModel } from "../../../src/nklein-agent/session-request-log-model";
import { readSessionWireRecords } from "../../../src/state/session-request-log-store";

const root = mkdtempSync(join(tmpdir(), "nklein-wire-tap-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function request(): AgentModelRequest {
	return {
		systemPrompt: "You are a test.",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
		tools: [{ name: "write_file" }],
	} as never;
}

function baseModel(events: AgentModelEvent[]): AgentModel {
	return {
		stream: () =>
			(async function* () {
				for (const event of events) {
					yield event;
				}
			})(),
	};
}

describe("session wire tap (F2.30(e) — requests AND responses)", () => {
	it("tees the stream untouched and records a correlated request+response pair", async () => {
		process.env.NKLEIN_SESSION_REQUEST_LOG_ROOT = root;
		try {
			const events: AgentModelEvent[] = [
				{ type: "reasoning-delta", text: "thinking… " },
				{ type: "text-delta", text: "Hello " },
				{ type: "text-delta", text: "world." },
				{ type: "tool-call-delta", toolCallId: "c1", toolName: "write_file", inputText: '{"path":"a.md"}' },
				{ type: "usage", usage: { inputTokens: 42, outputTokens: 7 } },
				{ type: "finish", reason: "tool_use" as never },
			];
			const tap = createSessionRequestLogModel(baseModel(events), {
				sessionId: "tap-test-1",
				modelId: "mock-model",
				purpose: "session_turn",
			});

			const seen: AgentModelEvent[] = [];
			for await (const event of await tap.stream(request())) {
				seen.push(event);
			}
			// Passthrough is verbatim: same events, same order.
			expect(seen).toEqual(events);

			// Give the fire-and-forget appends a beat to land.
			await new Promise((tick) => setTimeout(tick, 200));
			const records = await readSessionWireRecords("tap-test-1", { rootDir: root });
			const requestRecord = records.find((record) => !("kind" in record) || record.kind !== "response");
			const responseRecord = records.find((record) => "kind" in record && record.kind === "response");
			expect(requestRecord, "request record written").toBeTruthy();
			expect(responseRecord, "response record written").toBeTruthy();
			if (!responseRecord || !("text" in responseRecord)) {
				throw new Error("unreachable");
			}
			expect(responseRecord.text).toBe("Hello world.");
			expect(responseRecord.reasoningText).toContain("thinking");
			expect(responseRecord.toolCalls).toEqual([{ toolName: "write_file", argumentsText: '{"path":"a.md"}' }]);
			expect(responseRecord.inputTokens).toBe(42);
			expect(responseRecord.outputTokens).toBe(7);
			expect(responseRecord.finishReason).toBe("tool_use");
			// Correlation: both records carry the same turnId.
			expect("turnId" in (requestRecord ?? {}) && (requestRecord as { turnId?: string }).turnId).toBe(
				responseRecord.turnId,
			);
		} finally {
			delete process.env.NKLEIN_SESSION_REQUEST_LOG_ROOT;
		}
	});

	it("records the error and rethrows when the upstream stream throws mid-flight", async () => {
		process.env.NKLEIN_SESSION_REQUEST_LOG_ROOT = root;
		try {
			const explosive: AgentModel = {
				stream: () =>
					(async function* () {
						yield { type: "text-delta", text: "partial" } as AgentModelEvent;
						throw new Error("provider died");
					})(),
			};
			const tap = createSessionRequestLogModel(explosive, {
				sessionId: "tap-test-err",
				modelId: "mock-model",
				purpose: "session_turn",
			});
			await expect(async () => {
				for await (const _event of await tap.stream(request())) {
					// drain
				}
			}).rejects.toThrow("provider died");
			await new Promise((tick) => setTimeout(tick, 200));
			const records = await readSessionWireRecords("tap-test-err", { rootDir: root });
			const responseRecord = records.find((record) => "kind" in record && record.kind === "response");
			if (!responseRecord || !("error" in responseRecord)) {
				throw new Error("response record missing after mid-stream throw");
			}
			expect(responseRecord.error).toContain("provider died");
			expect(responseRecord.text).toBe("partial");
		} finally {
			delete process.env.NKLEIN_SESSION_REQUEST_LOG_ROOT;
		}
	});
});
