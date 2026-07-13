import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../../src/core/agent-attempt-ledger";
import {
	deriveToolCallIdempotencyKey,
	findRecordedToolCallResult,
	hashToolResultContent,
} from "../../../src/core/tool-result-record";
import { extractTerminalToolCalls } from "../../../src/nklein-agent/nklein-ledger-tool-calls";

/**
 * F1.16 — per-tool idempotency identity + durable result evidence: deterministic keys, canonical result hashes,
 * and the replay/resume lookup over the ledger's recorded tool calls.
 */

describe("hashToolResultContent", () => {
	it("is canonical (key order irrelevant), content-sensitive, and total on odd values", () => {
		expect(hashToolResultContent({ a: 1, b: [2, 3] })).toBe(hashToolResultContent({ b: [2, 3], a: 1 }));
		expect(hashToolResultContent({ a: 1 })).not.toBe(hashToolResultContent({ a: 2 }));
		expect(hashToolResultContent(null)).toBe(hashToolResultContent(undefined)); // both canonicalize to null
		expect(hashToolResultContent("text")).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("deriveToolCallIdempotencyKey", () => {
	it("is stable for the same identity and changes with ANY identity component", () => {
		const base = {
			workflowId: "wf",
			taskId: "t-1",
			toolName: "run_commands",
			inputFingerprint: "fp-1",
			occurrence: 0,
		};
		expect(deriveToolCallIdempotencyKey(base)).toBe(deriveToolCallIdempotencyKey({ ...base }));
		for (const change of [
			{ taskId: "t-2" },
			{ toolName: "write_file" },
			{ inputFingerprint: "fp-2" },
			{ inputFingerprint: null },
			{ occurrence: 1 },
		]) {
			expect(deriveToolCallIdempotencyKey({ ...base, ...change })).not.toBe(deriveToolCallIdempotencyKey(base));
		}
	});
});

describe("findRecordedToolCallResult", () => {
	it("returns the recorded executions of one logical call in occurrence order, across attempts", () => {
		const attempt = (at: number, calls: Array<{ name: string; fingerprint: string | null; resultHash?: string }>) =>
			buildAttemptEvent({
				workflowId: "wf",
				taskId: "t-1",
				workspacePathHash: "hash",
				attemptId: `a-${at}`,
				modelId: "m",
				outcome: "success",
				recordedAt: at,
				toolCalls: calls.map((call) => ({
					name: call.name,
					fingerprint: call.fingerprint,
					outcome: "success",
					...(call.resultHash ? { resultHash: call.resultHash } : {}),
				})),
			});
		const events = [
			attempt(200, [{ name: "run_commands", fingerprint: "fp-1", resultHash: "hash-2" }]),
			attempt(100, [
				{ name: "run_commands", fingerprint: "fp-1", resultHash: "hash-1" },
				{ name: "run_commands", fingerprint: "fp-other" },
				{ name: "read_files", fingerprint: "fp-1" },
			]),
		];
		const recorded = findRecordedToolCallResult(events, {
			taskId: "t-1",
			toolName: "run_commands",
			inputFingerprint: "fp-1",
		});
		expect(recorded).toEqual([
			expect.objectContaining({ occurrence: 0, resultHash: "hash-1", recordedAt: 100 }),
			expect.objectContaining({ occurrence: 1, resultHash: "hash-2", recordedAt: 200 }),
		]);
		// A never-recorded call returns empty — the executor may run it (first execution).
		expect(
			findRecordedToolCallResult(events, { taskId: "t-1", toolName: "run_commands", inputFingerprint: "fp-new" }),
		).toEqual([]);
	});
});

describe("extractTerminalToolCalls (F1.16 result hashes)", () => {
	it("stamps each completed call's durable result hash from the persisted transcript", () => {
		const calls = extractTerminalToolCalls([
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "u1", name: "read_files", input: { files: ["a.ts"] } }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "u1", content: "file contents", is_error: false }],
			},
		] as never);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.outcome).toBe("success");
		expect(calls[0]?.resultHash).toBe(hashToolResultContent("file contents"));
	});
});
