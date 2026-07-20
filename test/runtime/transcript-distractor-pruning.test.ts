import { describe, expect, it } from "vitest";
import { type PrunableMessage, pruneTranscriptDistractors } from "../../src/core/transcript-distractor-pruning";

function tool(index: number, target: string, opts: Partial<PrunableMessage> = {}): PrunableMessage {
	return { index, role: "tool", toolName: "read_files", target, tokens: 100, ...opts };
}

describe("pruneTranscriptDistractors", () => {
	it("prunes a read superseded by a later read of the same target", () => {
		const result = pruneTranscriptDistractors([tool(0, "src/a.ts"), tool(1, "src/a.ts")]);
		expect(result.prune.map((p) => p.index)).toEqual([0]);
		expect(result.prune[0]?.reason).toBe("superseded_read");
		expect(result.tokensFreed).toBe(100);
	});

	it("prunes a failure whose later retry SUCCEEDED", () => {
		const result = pruneTranscriptDistractors([tool(0, "src/a.ts", { failed: true }), tool(1, "src/a.ts")]);
		expect(result.prune[0]?.reason).toBe("resolved_failure");
	});

	it("NEVER prunes an earlier success followed by a later FAILURE", () => {
		// The success may hold the only good state we ever had for that target; a later failure does not
		// supersede it. Dropping it would send the model back into the wall with no record of what worked.
		const result = pruneTranscriptDistractors([tool(0, "src/a.ts"), tool(1, "src/a.ts", { failed: true })]);
		expect(result.prune).toHaveLength(0);
	});

	it("never prunes a pinned message", () => {
		const result = pruneTranscriptDistractors([tool(0, "src/a.ts", { pinned: true }), tool(1, "src/a.ts")]);
		expect(result.prune).toHaveLength(0);
	});

	it("keeps a lone result — one observation cannot be superseded", () => {
		expect(pruneTranscriptDistractors([tool(0, "src/a.ts")]).prune).toHaveLength(0);
	});

	it("keeps messages with no target — supersession cannot be PROVEN without one", () => {
		const result = pruneTranscriptDistractors([
			{ index: 0, role: "tool", toolName: "run", target: null, tokens: 50 },
			{ index: 1, role: "tool", toolName: "run", target: null, tokens: 50 },
		]);
		expect(result.prune).toHaveLength(0);
		expect(result.summary).toContain("cannot be proven is kept");
	});

	it("never prunes assistant or user reasoning, only tool results", () => {
		const result = pruneTranscriptDistractors([
			{ index: 0, role: "assistant", target: "src/a.ts", tokens: 100 },
			{ index: 1, role: "assistant", target: "src/a.ts", tokens: 100 },
		]);
		expect(result.prune).toHaveLength(0);
	});

	it("treats each target independently", () => {
		const result = pruneTranscriptDistractors([tool(0, "src/a.ts"), tool(1, "src/b.ts"), tool(2, "src/a.ts")]);
		expect(result.prune.map((p) => p.index)).toEqual([0]);
	});

	it("keeps every non-pruned index in `keep`", () => {
		const result = pruneTranscriptDistractors([tool(0, "x"), tool(1, "x"), tool(2, "y")]);
		expect(result.keep).toEqual([1, 2]);
	});

	it("states the prune-before-compact ordering in its summary", () => {
		const result = pruneTranscriptDistractors([tool(0, "x"), tool(1, "x")]);
		expect(result.summary).toContain("BEFORE compacting");
	});
});

describe("module separation", () => {
	it("is distinct from the §5.AD retrieval-result pruner", async () => {
		// Both are legitimately called 'distractor pruning'; they act on different things at different times.
		// This asserts the retrieval pruner still exists with its own API, so the two never get merged by accident.
		const retrieval = await import("../../src/core/distractor-pruning");
		expect(typeof retrieval.pruneDistractors).toBe("function");
	});
});
