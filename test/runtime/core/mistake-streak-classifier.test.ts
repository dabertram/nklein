import { describe, expect, it } from "vitest";
import {
	buildPolicyGuidanceContinueMessage,
	classifyMistakeStreak,
	POLICY_GUIDANCE_SOFT_CONTINUE_LIMIT,
} from "../../../src/core/mistake-streak-classifier";

describe("classifyMistakeStreak (David 2026-07-29: soften policy-guard streaks)", () => {
	it("classifies the live anti-re-read block streak as policy guidance", () => {
		// Verbatim shape from G6.8a runs: the guard that killed read-looping architects.
		expect(
			classifyMistakeStreak(
				'1 tool call(s) failed: [read_files] {"error":"Blocked read_files: this exact file content was already read successfully in this task. Use the file content you already have."}',
			),
		).toBe("policy_guidance");
	});

	it("classifies workspace path fences as policy guidance", () => {
		expect(
			classifyMistakeStreak(
				'1 tool call(s) failed: [read_files] {"error":"Blocked read_files: Absolute path is outside the workspace. Use a path relative to the workspace root."}',
			),
		).toBe("policy_guidance");
	});

	it("classifies the syntax-guard rejection wording as policy guidance", () => {
		expect(
			classifyMistakeStreak(
				"1 tool call(s) failed: [editor] this edit would break the file: unclosed brace — the change was rejected",
			),
		).toBe("policy_guidance");
	});

	it("keeps a genuine execution failure genuine", () => {
		expect(
			classifyMistakeStreak('1 tool call(s) failed: [run_commands] {"error":"npm test exited with code 1"}'),
		).toBe("genuine");
	});

	it("keeps a MIXED streak genuine — real failures must retain the abandonment teeth", () => {
		expect(
			classifyMistakeStreak(
				'2 tool call(s) failed: [read_files] {"error":"Blocked read_files: this exact read_files request was already approved in this task."}; [run_commands] {"error":"command not found: pytest"}',
			),
		).toBe("genuine");
	});

	it("keeps a mixed streak genuine when the GENUINE failure comes first (prefix-attached segment)", () => {
		expect(
			classifyMistakeStreak(
				'2 tool call(s) failed: [run_commands] {"error":"command not found: pytest"}; [read_files] {"error":"Blocked read_files: this exact file content was already read successfully in this task."}',
			),
		).toBe("genuine");
	});

	it("keeps the repeated-tool-call loop escalation genuine — that stop is the loop guard's designed park", () => {
		expect(classifyMistakeStreak("Detected repeated tool calls to `search_code`; stopping to avoid a loop.")).toBe(
			"genuine",
		);
	});

	it("treats empty/absent details as genuine (fail-closed toward the existing behavior)", () => {
		expect(classifyMistakeStreak(undefined)).toBe("genuine");
		expect(classifyMistakeStreak("  ")).toBe("genuine");
	});

	it("bounds the soften and phrases the continue as corrective guidance", () => {
		expect(POLICY_GUIDANCE_SOFT_CONTINUE_LIMIT).toBeGreaterThan(0);
		const message = buildPolicyGuidanceContinueMessage();
		expect(message).toContain("BLOCKED");
		expect(message).toContain("Do not repeat a blocked call verbatim");
	});
});
