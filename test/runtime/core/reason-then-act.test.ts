import { describe, expect, it } from "vitest";
import { buildReasonThenActPhaseB, extractDecidedTool } from "../../../src/core/reason-then-act";

describe("reason-then-act orchestration (§5.AD two-phase)", () => {
	describe("extractDecidedTool", () => {
		const tools = ["read_files", "write_file", "run_tests"];

		it("returns the LAST offered tool mentioned (the concluded decision)", () => {
			const reasoning =
				"First I could read_files to see the code, but really I need to write_file with the clamp. So I'll write_file.";
			expect(extractDecidedTool(reasoning, tools)).toBe("write_file");
		});

		it("matches case-insensitively but on word boundaries (no substring false-positive)", () => {
			// `write_file` must NOT match inside `overwrite_files`.
			expect(extractDecidedTool("I will overwrite_files everywhere", tools)).toBeNull();
			expect(extractDecidedTool("Use WRITE_FILE here", tools)).toBe("write_file");
		});

		it("returns null when no offered tool is named", () => {
			expect(extractDecidedTool("I'll just think about it more.", tools)).toBeNull();
			expect(extractDecidedTool("", tools)).toBeNull();
		});

		it("picks the tool whose final mention is latest across multiple tools", () => {
			const reasoning = "run_tests first? No. read_files? Then finally I decide: run_tests.";
			expect(extractDecidedTool(reasoning, tools)).toBe("run_tests");
		});
	});

	describe("buildReasonThenActPhaseB", () => {
		it("carries the reasoning forward and pins the decided tool", () => {
			const phaseB = buildReasonThenActPhaseB({
				instruction: "cap the score at 100",
				phaseAReasoning: "I need to clamp with Math.min(100, ...).",
				decidedToolName: "write_file",
			});
			expect(phaseB).toContain("Your reasoning so far:");
			expect(phaseB).toContain("Math.min(100");
			expect(phaseB).toContain("SINGLE `write_file` tool call");
			expect(phaseB).toContain("Task: cap the score at 100");
		});

		it("demands any single call when no tool was decided, and omits the reasoning block when empty", () => {
			const phaseB = buildReasonThenActPhaseB({ instruction: "do it", phaseAReasoning: "   " });
			expect(phaseB).not.toContain("Your reasoning so far:");
			expect(phaseB).toContain("produce a SINGLE tool call and nothing else");
			expect(phaseB).toContain("Task: do it");
		});

		it("composes with extractDecidedTool end-to-end", () => {
			const reasoning = "I'll read_files first, then write_file the fix.";
			const decided = extractDecidedTool(reasoning, ["read_files", "write_file"]);
			const phaseB = buildReasonThenActPhaseB({
				instruction: "fix it",
				phaseAReasoning: reasoning,
				decidedToolName: decided,
			});
			expect(phaseB).toContain("SINGLE `write_file` tool call");
		});
	});
});
