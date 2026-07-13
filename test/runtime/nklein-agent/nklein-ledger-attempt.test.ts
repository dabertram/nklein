import { describe, expect, it } from "vitest";
import { agentLedgerEventSchema } from "../../../src/core/agent-attempt-ledger";
import {
	buildTerminalAttemptEvent,
	hashWorkspacePathForLedger,
	mapTerminalStateToOutcome,
	type TerminalAttemptInput,
} from "../../../src/nklein-agent/nklein-ledger-attempt";

describe("mapTerminalStateToOutcome", () => {
	it("maps awaiting_review → success regardless of timeout", () => {
		expect(mapTerminalStateToOutcome("awaiting_review", false)).toBe("success");
		expect(mapTerminalStateToOutcome("awaiting_review", true)).toBe("success");
	});
	it("maps a timed-out failure → timeout, a plain failure → other_failure", () => {
		expect(mapTerminalStateToOutcome("failed", true)).toBe("timeout");
		expect(mapTerminalStateToOutcome("failed", false)).toBe("other_failure");
	});
	it("maps a no-timeout interrupt → aborted (a transient SDK abort, §5.AA), but a timed-out interrupt → timeout", () => {
		// An `interrupted` end with no !Klein timeout is a no-output transient abort, not a hard failure.
		expect(mapTerminalStateToOutcome("interrupted", false)).toBe("aborted");
		// If a real timeout fired, it stays a timeout (the timeout check wins).
		expect(mapTerminalStateToOutcome("interrupted", true)).toBe("timeout");
	});
});

describe("hashWorkspacePathForLedger", () => {
	it("is stable, host-path-free, and distinguishes paths", () => {
		const a = hashWorkspacePathForLedger("/Users/x/secret/repo");
		expect(a).toMatch(/^[0-9a-f]{16}$/);
		expect(a).not.toContain("/");
		expect(hashWorkspacePathForLedger("/Users/x/secret/repo")).toBe(a); // stable
		expect(hashWorkspacePathForLedger("/Users/x/other/repo")).not.toBe(a); // distinguishes
		expect(hashWorkspacePathForLedger(null)).toBe(hashWorkspacePathForLedger("")); // both → "unknown"
	});
});

describe("buildTerminalAttemptEvent", () => {
	const base: TerminalAttemptInput = {
		taskId: "t-1",
		workspacePath: "/repo",
		state: "awaiting_review",
		role: "worker",
		providerId: "lmstudio",
		modelId: "qwen/qwen3-8b",
		endpoint: "http://127.0.0.1:1234/v1",
		startedAt: 1_000,
		endedAt: 5_000,
		promptTokens: 800,
		completionTokens: 200,
		timeoutReason: null,
	};

	it("builds a schema-valid success attempt with a canonical model id + computed tok/s", () => {
		const event = buildTerminalAttemptEvent(base);
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
		expect(event.kind).toBe("attempt");
		expect(event.outcome).toBe("success");
		expect(event.qualityOk).toBe(true);
		expect(event.modelId).toContain("lmstudio");
		expect(event.modelId).toContain("qwen3-8b");
		expect(event.contextTokens).toBe(800);
		// 200 completion tokens over 4s = 50 tok/s.
		expect(event.tokensPerSec).toBe(50);
		expect(event.attemptId).toBe("t-1:5000");
	});

	it("maps a timed-out failure to outcome=timeout and carries the reason as salvage", () => {
		const event = buildTerminalAttemptEvent({ ...base, state: "failed", timeoutReason: "wall_time_exceeded" });
		expect(event.outcome).toBe("timeout");
		expect(event.qualityOk).toBe(false);
		expect(event.salvage).toBe("wall_time_exceeded");
	});

	it("records a no-timeout interrupt as a schema-valid aborted transient (not other_failure)", () => {
		const event = buildTerminalAttemptEvent({ ...base, state: "interrupted", timeoutReason: null });
		expect(event.outcome).toBe("aborted");
		expect(event.qualityOk).toBe(false);
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
	});

	it("F1.14: records the rung, the result-branch artifact, and the context budget target", () => {
		const event = buildTerminalAttemptEvent({
			...base,
			retriesBefore: 2,
			resultBranch: "refs/nklein/tasks/t-1",
			contextBudgetTarget: 32_768,
		});
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
		expect(event.retriesBefore).toBe(2);
		expect(event.artifacts).toEqual({ resultBranch: "refs/nklein/tasks/t-1", patchRef: null, evidenceBundle: null });
		expect(event.contextBudgetTarget).toBe(32_768);
		// Defaults stay backward-compatible: no rung/branch/budget supplied ⇒ 0 / null / null.
		const plain = buildTerminalAttemptEvent(base);
		expect(plain.retriesBefore).toBe(0);
		expect(plain.artifacts).toBeNull();
		expect(plain.contextBudgetTarget).toBeNull();
	});

	it("tolerates missing timing/usage (null tok/s, no crash)", () => {
		const event = buildTerminalAttemptEvent({
			...base,
			startedAt: null,
			completionTokens: null,
			promptTokens: null,
		});
		expect(event.tokensPerSec).toBeNull();
		expect(event.contextTokens).toBeNull();
		expect(agentLedgerEventSchema.safeParse(event).success).toBe(true);
	});
});
