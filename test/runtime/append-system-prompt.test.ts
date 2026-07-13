import { describe, expect, it } from "vitest";

import {
	renderAppendSystemPrompt,
	resolveAppendSystemPromptCommandPrefix,
	resolveHomeAgentAppendSystemPrompt,
} from "../../src/prompts/append-system-prompt";

describe("resolveAppendSystemPromptCommandPrefix", () => {
	it("returns npx prefix for npx transient installs", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			argv: ["node", "/Users/example/.npm/_npx/593b71878a7c70f2/node_modules/nklein/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("npx -y nklein");
	});

	it("returns bun x prefix for bun x transient installs", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			argv: ["node", "/private/tmp/bunx-501-kanban@1.0.0/node_modules/nklein/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("bun x nklein");
	});

	it("falls back to the current runnable invocation for local entrypoints", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prefix).toBe("'/usr/local/bin/node' '/Users/example/repo/dist/cli.js'");
	});

	it("falls back to the current runnable invocation when realpath resolution fails", () => {
		const prefix = resolveAppendSystemPromptCommandPrefix({
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/tmp/missing-kanban-cli.js"],
			resolveRealPath: () => {
				throw new Error("missing");
			},
		});
		expect(prefix).toBe("'/usr/local/bin/node' '/tmp/missing-kanban-cli.js'");
	});
});

describe("renderAppendSystemPrompt", () => {
	it("renders !Klein sidebar guidance and command reference", () => {
		const rendered = renderAppendSystemPrompt("nklein");
		expect(rendered).toContain("!Klein sidebar agent");
		expect(rendered).toContain("nklein task create");
		expect(rendered).toContain("nklein task done");
		expect(rendered).toContain("nklein task trash");
		expect(rendered).toContain("nklein task delete");
		expect(rendered).toContain("--column backlog|planning|in_progress|review|completed|done|trash");
		expect(rendered).toContain("Provide exactly one of");
		expect(rendered).toContain("task delete --column done");
		expect(rendered).toContain("nklein task link");
		expect(rendered).toContain("nklein task decompose --slug");
		expect(rendered).toContain(".nklein/nklein/plans/<slug>");
		expect(rendered).toContain("If a task command fails because the runtime is unavailable");
		expect(rendered).toContain("If the user asks for GitHub work");
		expect(rendered).toContain("gh issue view");
		expect(rendered).toContain("If the user references Linear");
		expect(rendered).toContain("Current home agent: `unknown`");
		expect(rendered).not.toContain("claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp");
		expect(rendered).not.toContain("codex mcp add linear --url https://mcp.linear.app/mcp");
	});

	it("renders only the active-agent Linear MCP guidance when an agent is provided", () => {
		const rendered = renderAppendSystemPrompt("nklein", {
			agentId: "nklein",
		});

		expect(rendered).toContain("Current home agent: `nklein`");
		expect(rendered).toContain("add an MCP server named `linear` with the HTTP URL `https://mcp.linear.app/mcp`");
		expect(rendered).not.toContain("claude mcp add --transport http --scope user linear https://mcp.linear.app/mcp");
		expect(rendered).not.toContain("codex mcp add linear --url https://mcp.linear.app/mcp");
	});
});

describe("resolveHomeAgentAppendSystemPrompt", () => {
	it("returns null for non-home task sessions", () => {
		expect(resolveHomeAgentAppendSystemPrompt("task-1")).toBeNull();
	});

	it("returns the appended prompt for current home sidebar sessions", () => {
		const prompt = resolveHomeAgentAppendSystemPrompt("__home_agent__:workspace-1:nklein", {
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prompt).toContain("!Klein sidebar agent");
		expect(prompt).toContain("'/usr/local/bin/node' '/Users/example/repo/dist/cli.js' task list");
		expect(prompt).toContain("Current home agent: `nklein`");
		expect(prompt).toContain("add an MCP server named `linear` with the HTTP URL `https://mcp.linear.app/mcp`");
	});

	it("falls back to generic Linear guidance for a legacy (retired-agent) home session id", () => {
		// P0.9c: pre-lockdown home sessions could be suffixed with terminal-CLI agent ids; those ids are no longer
		// RuntimeAgentIds, so the resolver treats them as unknown and the generic guidance renders.
		const prompt = resolveHomeAgentAppendSystemPrompt("__home_agent__:workspace-1:codex", {
			currentVersion: "0.1.10",
			cwd: "/Users/example/repo",
			execPath: "/usr/local/bin/node",
			execArgv: [],
			argv: ["node", "/Users/example/repo/dist/cli.js"],
			resolveRealPath: (path) => path,
		});
		expect(prompt).toContain("Current home agent: `unknown`");
		expect(prompt).toContain("If Linear MCP is not available, provide setup instructions for the active agent only");
	});
});
