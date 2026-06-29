import { describe, expect, it } from "vitest";
import {
	ROLE_MODEL_CLASS_PREFERENCES,
	rankModelsForRole,
	SWARM_ROLES,
	scoreModelClassFitForRole,
} from "../../../src/core/role-model-class";

describe("ROLE_MODEL_CLASS_PREFERENCES", () => {
	it("covers exactly the three canonical swarm roles", () => {
		expect(Object.keys(ROLE_MODEL_CLASS_PREFERENCES).sort()).toEqual([...SWARM_ROLES].sort());
	});

	it("makes only the worker require tool use", () => {
		expect(ROLE_MODEL_CLASS_PREFERENCES.worker.requiresToolUse).toBe(true);
		expect(ROLE_MODEL_CLASS_PREFERENCES.architect.requiresToolUse).toBe(false);
		expect(ROLE_MODEL_CLASS_PREFERENCES.reviewer.requiresToolUse).toBe(false);
	});
});

describe("scoreModelClassFitForRole", () => {
	it("prefers a reasoning model for the architect over a chat model", () => {
		const reasoning = scoreModelClassFitForRole("architect", { kind: "reasoning", toolUse: "TOOL_CAPABLE" });
		const chat = scoreModelClassFitForRole("architect", { kind: "chat", toolUse: "TOOL_CAPABLE" });
		expect(reasoning.score).toBeGreaterThan(chat.score);
		expect(reasoning.eligible).toBe(true);
	});

	it("prefers a tool-native code model for the worker over a reasoning-only one", () => {
		const coder = scoreModelClassFitForRole("worker", { kind: "code", toolUse: "TOOL_NATIVE" });
		const reasoner = scoreModelClassFitForRole("worker", { kind: "reasoning", toolUse: "TOOL_WEAK" });
		expect(coder.score).toBeGreaterThan(reasoner.score);
	});

	it("marks a tool-unsuitable model INELIGIBLE for the worker (score 0) but eligible for the reviewer", () => {
		const asWorker = scoreModelClassFitForRole("worker", { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" });
		expect(asWorker.eligible).toBe(false);
		expect(asWorker.score).toBe(0);
		expect(asWorker.rationale).toMatch(/requires tool use/);

		const asReviewer = scoreModelClassFitForRole("reviewer", { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" });
		expect(asReviewer.eligible).toBe(true);
		expect(asReviewer.score).toBeGreaterThan(0); // reasoning-only still reviews well
	});

	it("weights tool use more heavily for the worker than for the reviewer", () => {
		// same kind, only the tool verdict differs → the gap should be larger for the worker.
		const workerHi = scoreModelClassFitForRole("worker", { kind: "instruct", toolUse: "TOOL_NATIVE" }).score;
		const workerLo = scoreModelClassFitForRole("worker", { kind: "instruct", toolUse: "TOOL_WEAK" }).score;
		const reviewerHi = scoreModelClassFitForRole("reviewer", { kind: "instruct", toolUse: "TOOL_NATIVE" }).score;
		const reviewerLo = scoreModelClassFitForRole("reviewer", { kind: "instruct", toolUse: "TOOL_WEAK" }).score;
		expect(workerHi - workerLo).toBeGreaterThan(reviewerHi - reviewerLo);
	});
});

describe("rankModelsForRole", () => {
	it("ranks eligible-first then by score, stable by modelKey", () => {
		const ranked = rankModelsForRole("worker", [
			{ modelKey: "reasoner", facts: { kind: "reasoning", toolUse: "TOOL_UNSUITABLE" } }, // ineligible
			{ modelKey: "coder-a", facts: { kind: "code", toolUse: "TOOL_NATIVE" } },
			{ modelKey: "coder-b", facts: { kind: "code", toolUse: "TOOL_NATIVE" } }, // tie → alpha order
			{ modelKey: "instruct", facts: { kind: "instruct", toolUse: "TOOL_CAPABLE" } },
		]);
		expect(ranked.map((r) => r.modelKey)).toEqual(["coder-a", "coder-b", "instruct", "reasoner"]);
		expect(ranked.at(-1)?.eligible).toBe(false);
	});

	it("falls back to a neutral, never-ineligible class for an unknown model id", () => {
		const [only] = rankModelsForRole("worker", [{ modelKey: "totally-unknown-model-xyz" }]);
		expect(only.eligible).toBe(true); // UNKNOWN tool verdict is not TOOL_UNSUITABLE
		expect(only.score).toBeGreaterThan(0);
	});
});
