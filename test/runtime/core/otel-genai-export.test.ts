import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import {
	attemptEventToOtelSpans,
	buildOtlpTracePayload,
	deriveOtelSpanId,
	deriveOtelTraceId,
} from "../../../src/core/otel-genai-export";

const event = (over: object = {}) =>
	buildAttemptEvent({
		eventId: "e1",
		recordedAt: 1_000,
		workflowId: "wf",
		taskId: "task-1",
		workspacePathHash: "h",
		role: "worker",
		attemptId: "a1",
		modelId: "qwable-3.6-27b",
		startedAt: 1_000,
		completedAt: 4_000,
		contextTokens: 1234,
		toolCalls: [
			{ name: "read_files", fingerprint: "fp1", outcome: "ok", resultHash: "rh", filePaths: ["a.ts"] },
			{ name: "edit_file", fingerprint: "fp2", outcome: "rejected" },
		],
		outcome: "success",
		...over,
	});

describe("otel genai export (F12.47)", () => {
	it("derives deterministic, well-formed trace/span ids", () => {
		expect(deriveOtelTraceId("wf", "task-1")).toMatch(/^[0-9a-f]{32}$/);
		expect(deriveOtelSpanId("a1")).toMatch(/^[0-9a-f]{16}$/);
		expect(deriveOtelTraceId("wf", "task-1")).toBe(deriveOtelTraceId("wf", "task-1"));
		expect(deriveOtelTraceId("wf", "task-1")).not.toBe(deriveOtelTraceId("wf", "task-2"));
	});

	it("maps an attempt to an invoke_agent parent + execute_tool children with genai attributes", () => {
		const spans = attemptEventToOtelSpans(event());
		expect(spans).toHaveLength(3);
		const [parent, tool1, tool2] = spans;
		expect(parent.name).toBe("invoke_agent worker");
		expect(parent.startTimeUnixNano).toBe("1000000000");
		expect(parent.endTimeUnixNano).toBe("4000000000");
		expect(parent.status.code).toBe(1);
		const model = parent.attributes.find((a) => a.key === "gen_ai.request.model");
		expect(model?.value.stringValue).toBe("qwable-3.6-27b");
		expect(tool1.parentSpanId).toBe(parent.spanId);
		expect(tool1.name).toBe("execute_tool read_files");
		expect(tool1.status.code).toBe(1);
		expect(tool2.status.code).toBe(2); // rejected tool call = error status
		expect(tool1.spanId).not.toBe(tool2.spanId);
	});

	it("marks error outcomes on the parent and links parentAttemptId as parentSpanId", () => {
		const spans = attemptEventToOtelSpans(event({ outcome: "timeout", parentAttemptId: "a0", toolCalls: [] }));
		expect(spans).toHaveLength(1);
		expect(spans[0].status).toEqual({ code: 2, message: "timeout" });
		expect(spans[0].parentSpanId).toBe(deriveOtelSpanId("a0"));
	});

	it("wraps spans in an OTLP resourceSpans envelope with the service name", () => {
		const payload = buildOtlpTracePayload(attemptEventToOtelSpans(event()), { serviceName: "nklein-dev" });
		expect(payload.resourceSpans).toHaveLength(1);
		const service = payload.resourceSpans[0].resource.attributes.find((a) => a.key === "service.name");
		expect(service?.value.stringValue).toBe("nklein-dev");
		expect(payload.resourceSpans[0].scopeSpans[0].spans).toHaveLength(3);
	});
});
