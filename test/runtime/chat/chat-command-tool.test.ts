import { describe, expect, it, vi } from "vitest";
import { type CommandRunResult, createCommandRunTool } from "../../../src/chat/chat-command-tool";

function tool(run: (input: { command: string; cwd: string; timeoutMs: number }) => Promise<CommandRunResult>) {
	const { tools } = createCommandRunTool("/work", { runner: { run } });
	const found = tools.find((candidate) => candidate.name === "run_command");
	if (!found) {
		throw new Error("run_command tool missing");
	}
	return found;
}

const ok = (over: Partial<CommandRunResult> = {}): CommandRunResult => ({
	stdout: "",
	stderr: "",
	exitCode: 0,
	timedOut: false,
	...over,
});

describe("createCommandRunTool — run_command", () => {
	it("is a host_command action (gated as a host action by the execution-mode policy)", () => {
		const { tools } = createCommandRunTool("/work");
		expect(tools[0]?.actionKind).toBe("host_command");
	});

	it("runs the command in the workspace cwd and reports exit code + stdout", async () => {
		const run = vi.fn(async () => ok({ stdout: "hello\n", exitCode: 0 }));
		const out = await tool(run).run({ command: "echo hello" });
		expect(run).toHaveBeenCalledWith(expect.objectContaining({ command: "echo hello", cwd: "/work" }));
		expect(out).toContain("Command exited with code 0.");
		expect(out).toContain("stdout:\nhello");
	});

	it("surfaces a non-zero exit code and stderr", async () => {
		const out = await tool(async () => ok({ stderr: "boom", exitCode: 1 })).run({ command: "false" });
		expect(out).toContain("Command exited with code 1.");
		expect(out).toContain("stderr:\nboom");
	});

	it("reports a timeout distinctly", async () => {
		const out = await tool(async () => ok({ exitCode: null, timedOut: true })).run({ command: "sleep 999" });
		expect(out).toContain("Command timed out and was killed.");
	});

	it("notes (no output) when the command is silent", async () => {
		const out = await tool(async () => ok()).run({ command: "true" });
		expect(out).toContain("(no output)");
	});

	it("rejects an empty command without invoking the runner", async () => {
		const run = vi.fn(async () => ok());
		const out = await tool(run).run({ command: "   " });
		expect(out).toBe("Provide a `command` string to run.");
		expect(run).not.toHaveBeenCalled();
	});

	it("truncates very long output so it can't blow the agent's context", async () => {
		const huge = "x".repeat(50_000);
		const { tools } = createCommandRunTool("/work", {
			runner: { run: async () => ok({ stdout: huge }) },
			maxOutputChars: 100,
		});
		const out = await (tools.find((t) => t.name === "run_command")?.run({ command: "cat big" }) ??
			Promise.resolve(""));
		expect(out).toContain("[truncated:");
		expect(out.length).toBeLessThan(1_000);
	});
});
