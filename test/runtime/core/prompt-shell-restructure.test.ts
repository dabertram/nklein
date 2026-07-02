import { describe, expect, it } from "vitest";
import { computeSharedPrefixRatio } from "../../../src/core/prompt-fragment-assembly";
import { restructureSystemPromptForPrefixStability } from "../../../src/core/prompt-shell-restructure";

/**
 * A base prompt mirroring the vendored SDK template shape (`DEFAULT_CLINE_SYSTEM_PROMPT` after substitution):
 * static intro → `<env>` block with the volatile Date/Working Directory lines in the MIDDLE → a long static
 * rules section AFTER it. Long enough that the static shell dominates the byte count, like the real prompt.
 */
function buildVendorShapedPrompt(cwd: string, date: string): string {
	return `You are NKlein, an AI coding agent. Your primary goal is to assist users with various coding tasks by leveraging your knowledge and the tools at your disposal.

Always gather all the necessary context before starting to work on a task. Review each question carefully and answer it with detailed, accurate information.

Environment you are running in:
<env>
1. Platform: darwin
2. Date: ${date}
3. IDE: !Klein
4. Working Directory: ${cwd}
</env>

Remember:
- Always adhere to existing code conventions and patterns.
- Use only libraries and frameworks that are confirmed to be in use in the current codebase.
- Provide complete and functional code without omissions or placeholders.
- Be explicit about any assumptions or limitations in your solution.
- Always show your planning process before executing any task.
- Always use absolute paths when referring to files.
- You can call multiple tools in a single response. Before using tools, identify every independent read, search, command, or edit needed for the next step and emit all of those tool calls now.
- Always verify the files you have edited or created at the end of the task to ensure they are completed and working as expected.

REMEMBER, be helpful and proactive! When you have completed the task, please provide a summary of what you did and any relevant information that the user should know.`;
}

describe("restructureSystemPromptForPrefixStability (§5.AQ(e) byte-stable prompt shells)", () => {
	it("moves the Date + Working Directory lines out of <env> into a trailing <session> block", () => {
		const cwd = "/workspaces/task-42";
		const date = "7/2/2026";
		const shell = restructureSystemPromptForPrefixStability(buildVendorShapedPrompt(cwd, date), { cwd, date });

		expect(shell.envBlockEdited).toBe(true);
		// The static shell keeps the env block but loses the volatile lines (Platform/IDE stay, renumbered).
		expect(shell.staticText).toContain("<env>\n1. Platform: darwin\n2. IDE: !Klein\n</env>");
		expect(shell.staticText).not.toContain("Date:");
		expect(shell.staticText).not.toContain("Working Directory:");
		expect(shell.staticText).not.toContain(cwd);
		// The trailer carries the SAME information — models still see cwd + date, just at the end.
		expect(shell.sessionEnvText).toBe(`<session>\nWorking Directory: ${cwd}\nDate: ${date}\n</session>`);
		expect(shell.text).toBe(`${shell.staticText}\n\n${shell.sessionEnvText}`);
		expect(shell.text.endsWith("</session>")).toBe(true);
	});

	it("keeps the static shell byte-identical across different cwd/date — the trailer is the only divergence", () => {
		const taskA = restructureSystemPromptForPrefixStability(
			buildVendorShapedPrompt("/workspaces/task-a", "7/2/2026"),
			{ cwd: "/workspaces/task-a", date: "7/2/2026" },
		);
		const taskB = restructureSystemPromptForPrefixStability(
			buildVendorShapedPrompt("/workspaces/task-b", "7/3/2026"),
			{ cwd: "/workspaces/task-b", date: "7/3/2026" },
		);

		// Everything before the trailer is byte-identical — the whole static shell is a shared cache prefix.
		expect(taskA.staticText).toBe(taskB.staticText);
		expect(taskA.text.startsWith(`${taskA.staticText}\n\n<session>\nWorking Directory: /workspaces/task-`)).toBe(
			true,
		);
		// Two tasks in the same workspace now share >90% of prompt bytes as an exact contiguous prefix (was ~8%
		// live when the cwd diverged the prompts at byte ~1700 with 2k+ static bytes stranded behind it).
		expect(computeSharedPrefixRatio(taskA.text, taskB.text)).toBeGreaterThan(0.9);
	});

	it("prefers the exact values extracted from the built prompt over the provided fallbacks", () => {
		// Information preservation: the trailer must re-emit the vendor-written bytes verbatim (no date-format
		// drift, no midnight race between the vendor's clock read and the caller's fallback).
		const shell = restructureSystemPromptForPrefixStability(
			buildVendorShapedPrompt("/workspaces/task-1", "02.07.2026"),
			{ cwd: "/workspaces/other", date: "9/9/2029" },
		);
		expect(shell.sessionEnvText).toContain("Working Directory: /workspaces/task-1");
		expect(shell.sessionEnvText).toContain("Date: 02.07.2026");
	});

	it("falls back safely on a prompt without an <env> block: base untouched, trailer appended, nothing lost", () => {
		const base = "You are a reviewer. Judge the diff strictly.";
		const shell = restructureSystemPromptForPrefixStability(base, { cwd: "/workspaces/task-9", date: "7/2/2026" });

		expect(shell.envBlockEdited).toBe(false);
		expect(shell.staticText).toBe(base);
		expect(shell.sessionEnvText).toBe("<session>\nWorking Directory: /workspaces/task-9\nDate: 7/2/2026\n</session>");
		expect(shell.text).toBe(`${base}\n\n${shell.sessionEnvText}`);
	});

	it("leaves an <env> block without volatile lines byte-untouched (no edit, no renumbering churn)", () => {
		const base = "Intro.\n<env>\n1. Platform: darwin\n2. IDE: !Klein\n</env>\nRules.";
		const shell = restructureSystemPromptForPrefixStability(base, { cwd: "/workspaces/task-3", date: "7/2/2026" });
		expect(shell.envBlockEdited).toBe(false);
		expect(shell.staticText).toBe(base);
		expect(shell.sessionEnvText).toContain("Working Directory: /workspaces/task-3");
	});

	it("returns just the trailer for an empty base prompt (no stray separators)", () => {
		const shell = restructureSystemPromptForPrefixStability("", { cwd: "/w", date: "7/2/2026" });
		expect(shell.text).toBe(shell.sessionEnvText);
	});
});
