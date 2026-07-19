import { describe, expect, it } from "vitest";
import { buildAttemptEvent } from "../../src/core/agent-attempt-ledger";
import {
	buildPromptReflectionPrompt,
	DEFAULT_MIN_EFFECT_POINTS,
	decidePromptAdoption,
	type PairedTaskResult,
	summarizeFailurePatterns,
} from "../../src/core/prompt-evolution-gate";

const base = { workflowId: "wf", taskId: "t", workspacePathHash: "ws" };

function attempt(
	outcome: "success" | "other_failure" | "no_tool_call" | "timeout",
	calls: readonly (string | null)[] = [],
) {
	return buildAttemptEvent({
		...base,
		attemptId: `${outcome}-${calls.join("-")}-${Math.abs(calls.length)}`,
		modelId: "qwen3-14b",
		role: "worker",
		outcome,
		toolCalls: calls.map((o, i) => ({ name: `tool-${i}`, fingerprint: null, outcome: o })),
	});
}

describe("summarizeFailurePatterns", () => {
	it("counts attempts and successes for the model x role pairing", () => {
		const summary = summarizeFailurePatterns(
			[attempt("success", ["ok"]), attempt("other_failure", ["error"])],
			"qwen3-14b",
			"worker",
		);
		expect(summary.attempts).toBe(2);
		expect(summary.successes).toBe(1);
	});

	it("classifies a no-tool-call failure distinctly from a failed tool call", () => {
		const summary = summarizeFailurePatterns(
			[attempt("no_tool_call", []), attempt("other_failure", ["error"])],
			"qwen3-14b",
			"worker",
		);
		const kinds = summary.patterns.map((p) => p.kind);
		expect(kinds).toContain("no_tool_call");
		expect(kinds).toContain("other_failure");
	});

	it("ignores other models and roles", () => {
		const other = buildAttemptEvent({
			...base,
			attemptId: "x",
			modelId: "other",
			role: "worker",
			outcome: "other_failure",
		});
		expect(summarizeFailurePatterns([other], "qwen3-14b", "worker").attempts).toBe(0);
	});

	it("carries no card text — only counts and classes", () => {
		const summary = summarizeFailurePatterns([attempt("other_failure", ["error"])], "qwen3-14b", "worker");
		expect(JSON.stringify(summary)).not.toContain("taskId");
	});
});

describe("buildPromptReflectionPrompt", () => {
	it("asks for a bounded delta, never a rewrite", () => {
		const prompt = buildPromptReflectionPrompt({
			incumbentPrompt: "You are a worker.",
			reflection: { modelId: "m", role: "worker", attempts: 10, successes: 4, patterns: [] },
		});
		expect(prompt).toContain("AT MOST 3 changes");
		expect(prompt).toContain("Do NOT rewrite the whole prompt");
	});

	it("offers an explicit NO CHANGE escape so the loop can decline to edit", () => {
		const prompt = buildPromptReflectionPrompt({
			incumbentPrompt: "x",
			reflection: { modelId: "m", role: "worker", attempts: 1, successes: 0, patterns: [] },
		});
		expect(prompt).toContain("NO CHANGE");
	});
});

function pairs(candidateWins: number, incumbentWins: number, ties: number): PairedTaskResult[] {
	const out: PairedTaskResult[] = [];
	for (let i = 0; i < candidateWins; i += 1)
		out.push({ taskId: `c${i}`, incumbentPassed: false, candidatePassed: true });
	for (let i = 0; i < incumbentWins; i += 1)
		out.push({ taskId: `i${i}`, incumbentPassed: true, candidatePassed: false });
	for (let i = 0; i < ties; i += 1) out.push({ taskId: `t${i}`, incumbentPassed: true, candidatePassed: true });
	return out;
}

describe("decidePromptAdoption", () => {
	it("adopts a clear, adequately-powered win", () => {
		const decision = decidePromptAdoption({ results: pairs(14, 2, 4) });
		expect(decision.verdict).toBe("adopt");
	});

	it("rejects a clear loss", () => {
		const decision = decidePromptAdoption({ results: pairs(2, 14, 4) });
		expect(decision.verdict).toBe("reject");
	});

	it("reports UNRESOLVED — not reject — on too few discordant pairs", () => {
		// The distinction matters: 'reject' says the candidate is worse; 'unresolved' says we learned nothing.
		const decision = decidePromptAdoption({ results: pairs(3, 0, 40) });
		expect(decision.verdict).toBe("unresolved");
		expect(decision.reason).toContain("NOT a rejection");
	});

	it("reports UNRESOLVED when the effect is inside the pre-registered MDE", () => {
		// 10 vs 8 over 100 tasks = 2pp, well under the default 10pp bar despite 18 discordant pairs.
		const decision = decidePromptAdoption({ results: pairs(10, 8, 82) });
		expect(decision.verdict).toBe("unresolved");
		expect(decision.reason).toContain("minimum detectable effect");
	});

	it("counts ties against the challenger — the incumbent must be beaten, not merely matched", () => {
		// 9 wins / 1 loss but 90 ties: the effect over the FULL task set is 8pp, under the bar.
		const decision = decidePromptAdoption({ results: pairs(9, 1, 90) });
		expect(decision.verdict).toBe("unresolved");
		expect(decision.ties).toBe(90);
	});

	it("returns unresolved for an empty comparison", () => {
		expect(decidePromptAdoption({ results: [] }).verdict).toBe("unresolved");
	});

	it("honours a caller-supplied stricter MDE", () => {
		const lenient = decidePromptAdoption({ results: pairs(14, 2, 4), minEffectPoints: 10 });
		const strict = decidePromptAdoption({ results: pairs(14, 2, 4), minEffectPoints: 90 });
		expect(lenient.verdict).toBe("adopt");
		expect(strict.verdict).toBe("unresolved");
	});

	it("exposes the default MDE as a named constant so it can be pre-registered", () => {
		expect(DEFAULT_MIN_EFFECT_POINTS).toBeGreaterThan(0);
	});
});
