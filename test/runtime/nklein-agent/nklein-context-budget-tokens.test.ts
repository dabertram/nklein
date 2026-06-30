import { describe, expect, it } from "vitest";

import {
	buildContextBudgetBreakdown,
	classifyContextHistoryTokens,
	estimateKanbanToolSchemaTokens,
	estimateNextPromptTokens,
} from "../../../src/nklein-agent/nklein-context-budget-tokens";
import type { NKleinSdkPersistedMessage } from "../../../src/nklein-agent/sdk-runtime-boundary";

function readFileMessages(
	toolUseId: string,
	content: string,
	toolName: "read_files" | "read_large_file" = "read_files",
): NKleinSdkPersistedMessage[] {
	return [
		{ role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: toolName, input: { path: "a.ts" } }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, name: toolName, content }] },
	];
}

describe("classifyContextHistoryTokens", () => {
	it("counts a plain user string message into userMessageTokens (no file content)", () => {
		const segments = classifyContextHistoryTokens([
			{ role: "user", content: "implement the parser for the config file" },
		]);
		expect(segments.userMessageTokens).toBeGreaterThan(0);
		expect(segments.includedFileContentTokens).toBe(0);
	});

	it("attributes a read_files tool-result's content to includedFileContentTokens", () => {
		const segments = classifyContextHistoryTokens(readFileMessages("read-1", "the quick brown fox ".repeat(40)));
		expect(segments.includedFileContentTokens).toBeGreaterThan(0);
		// The included-file content is NOT also double-counted as a user message.
		expect(segments.userMessageTokens).toBe(0);
	});

	it("also recognizes read_large_file as a file-read tool", () => {
		const segments = classifyContextHistoryTokens(readFileMessages("read-2", "x ".repeat(50), "read_large_file"));
		expect(segments.includedFileContentTokens).toBeGreaterThan(0);
	});

	it("does NOT attribute a non-file-read tool result to includedFileContentTokens", () => {
		const messages: NKleinSdkPersistedMessage[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "bash-1", name: "run_command", input: { command: "ls" } }],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "bash-1",
						name: "run_command",
						content: "lots of shell output ".repeat(20),
					},
				],
			},
		];
		expect(classifyContextHistoryTokens(messages).includedFileContentTokens).toBe(0);
	});

	it("keeps the segments consistent: each ≥ 0 and user+file ≤ total (other absorbs the remainder)", () => {
		const messages: NKleinSdkPersistedMessage[] = [
			{ role: "user", content: "please read the file and summarize it" },
			...readFileMessages("read-3", "file body line ".repeat(30)),
			{ role: "assistant", content: "Here is the summary of what I found in the file." },
		];
		const s = classifyContextHistoryTokens(messages);
		expect(s.userMessageTokens).toBeGreaterThanOrEqual(0);
		expect(s.includedFileContentTokens).toBeGreaterThanOrEqual(0);
		expect(s.otherHistoryTokens).toBeGreaterThanOrEqual(0);
		expect(s.userMessageTokens + s.includedFileContentTokens).toBeLessThanOrEqual(
			s.userMessageTokens + s.includedFileContentTokens + s.otherHistoryTokens,
		);
	});

	it("returns all-zero segments for an empty history", () => {
		expect(classifyContextHistoryTokens([])).toEqual({
			userMessageTokens: 0,
			includedFileContentTokens: 0,
			otherHistoryTokens: 0,
		});
	});
});

describe("estimateKanbanToolSchemaTokens", () => {
	it("is 0 when there are no tool policies", () => {
		expect(estimateKanbanToolSchemaTokens(undefined)).toBe(0);
	});

	it("is 0 when every tool is disabled", () => {
		expect(estimateKanbanToolSchemaTokens({ create_card: { enabled: false }, run_command: { enabled: false } })).toBe(
			0,
		);
	});

	it("is positive when at least one tool is enabled, and grows with more enabled tools", () => {
		const one = estimateKanbanToolSchemaTokens({ create_card: { enabled: true } });
		const many = estimateKanbanToolSchemaTokens({
			create_card: { enabled: true },
			run_command: { enabled: true },
			read_files: { enabled: true },
		});
		expect(one).toBeGreaterThan(0);
		expect(many).toBeGreaterThan(one);
	});

	it("treats a policy without an explicit `enabled` as enabled (default-on)", () => {
		expect(estimateKanbanToolSchemaTokens({ create_card: {} })).toBeGreaterThan(0);
	});
});

describe("estimateNextPromptTokens", () => {
	it("floors at the prompt-overhead reserve and adds per-image overhead", () => {
		const empty = estimateNextPromptTokens("");
		const withText = estimateNextPromptTokens("write a parser for the config file");
		const withImage = estimateNextPromptTokens("", [{ id: "img1", data: "AAAA", mimeType: "image/png" }]);
		expect(empty).toBeGreaterThan(0); // floored at the reserve
		expect(withText).toBeGreaterThanOrEqual(empty);
		expect(withImage).toBeGreaterThan(empty); // a flat per-image overhead is added
	});
});

describe("buildContextBudgetBreakdown", () => {
	it("sums the segments into projectedTokens and leaves the remainder free", () => {
		const b = buildContextBudgetBreakdown({
			systemPrompt: "You are a careful assistant.",
			toolSchemaTokens: 100,
			messages: [{ role: "user", content: "please read and summarize the file" }],
			prompt: "go",
			contextWindow: 40_000,
		});
		expect(b.effectiveContextWindow).toBe(40_000);
		expect(b.systemPromptTokens).toBeGreaterThan(0);
		expect(b.toolSchemaTokens).toBe(100);
		expect(b.projectedTokens).toBe(
			b.systemPromptTokens +
				b.toolSchemaTokens +
				b.taskPromptTokens +
				b.userMessageTokens +
				b.includedFileContentTokens +
				b.otherHistoryTokens +
				b.reservedPromptOverheadTokens +
				b.reservedOutputTokens,
		);
		expect(b.freeWorkingTokens).toBe(Math.max(0, 40_000 - b.projectedTokens));
	});

	it("coerces a non-finite toolSchemaTokens to 0", () => {
		const b = buildContextBudgetBreakdown({ toolSchemaTokens: Number.NaN, prompt: "x", contextWindow: 8_000 });
		expect(b.toolSchemaTokens).toBe(0);
	});
});
