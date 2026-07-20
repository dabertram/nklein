import { describe, expect, it } from "vitest";
import { buildTerminalAttemptEvent } from "../../src/nklein-agent/nklein-ledger-attempt";

/**
 * N18 — reasoning tokens flow to the per-attempt ledger. Additive with a null default, so old v1 records (which
 * lack the field) still parse, and a reported count is carried. null and 0 must stay distinct.
 */

const base = {
	taskId: "t1",
	workspacePath: "/w",
	state: "awaiting_review" as const,
	role: "worker",
	providerId: "lmstudio",
	modelId: "coder-14b",
	endpoint: "http://localhost:1234",
	startedAt: 1000,
	endedAt: 5000,
	promptTokens: 100,
	completionTokens: 400,
	timeoutReason: null,
};

describe("ledger reasoning tokens", () => {
	it("carries a reported reasoning count onto the attempt event", () => {
		const event = buildTerminalAttemptEvent({ ...base, reasoningTokens: 250 });
		expect(event).toMatchObject({ kind: "attempt", reasoningTokens: 250 });
	});

	it("records null (not 0) when reasoning was not reported", () => {
		const event = buildTerminalAttemptEvent(base);
		expect(event).toMatchObject({ kind: "attempt", reasoningTokens: null });
	});

	it("keeps 0 distinct from null — a model that genuinely did zero reasoning", () => {
		const event = buildTerminalAttemptEvent({ ...base, reasoningTokens: 0 });
		expect((event as { reasoningTokens?: number | null }).reasoningTokens).toBe(0);
	});
});
