import { afterEach, describe, expect, it, vi } from "vitest";

const evalHarnessMocks = vi.hoisted(() => ({
	buildClineAdvisorRequest: vi.fn(),
	buildClineModelFreshnessAdvisorRequest: vi.fn(),
	runClineDevSmokeEval: vi.fn(),
	writeClineDogfoodBacklog: vi.fn(),
}));

vi.mock("../../../src/cline-sdk/cline-advisor", () => ({
	buildClineAdvisorRequest: evalHarnessMocks.buildClineAdvisorRequest,
}));

vi.mock("../../../src/cline-sdk/cline-eval-harness", () => ({
	runClineDevSmokeEval: evalHarnessMocks.runClineDevSmokeEval,
}));

vi.mock("../../../src/cline-sdk/cline-dogfood-engine", () => ({
	writeClineDogfoodBacklog: evalHarnessMocks.writeClineDogfoodBacklog,
}));

vi.mock("../../../src/cline-sdk/cline-model-research", () => ({
	buildClineModelFreshnessAdvisorRequest: evalHarnessMocks.buildClineModelFreshnessAdvisorRequest,
}));

import {
	runDevAdvisorPromptCommand,
	runDevAdvisorShortcutCommand,
	runDevCheckModelsCommand,
	runDevDogfoodBacklogCommand,
	runDevSmokeEvalCommand,
} from "../../../src/commands/dev";

describe("dev command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		evalHarnessMocks.buildClineAdvisorRequest.mockReset();
		evalHarnessMocks.buildClineModelFreshnessAdvisorRequest.mockReset();
		evalHarnessMocks.runClineDevSmokeEval.mockReset();
		evalHarnessMocks.writeClineDogfoodBacklog.mockReset();
	});

	it("runs the smoke eval and prints human-readable output", async () => {
		evalHarnessMocks.runClineDevSmokeEval.mockResolvedValue({
			workspacePath: "/tmp/workspace",
			evidenceBundlePath: "/tmp/evidence",
			acceptanceCommand: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
		});
		const writes: string[] = [];

		await runDevSmokeEvalCommand({
			parentDir: "/tmp/workspaces",
			evidenceRoot: "/tmp/evidence-root",
			telemetryRoot: "/tmp/telemetry-root",
			git: false,
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://127.0.0.1:11434",
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.runClineDevSmokeEval).toHaveBeenCalledWith({
			parentDir: "/tmp/workspaces",
			evidenceRootDir: "/tmp/evidence-root",
			telemetryRootDir: "/tmp/telemetry-root",
			initializeGit: false,
			modelObservation: {
				providerId: "ollama",
				modelId: "qwen3.5-9b",
				endpoint: "http://127.0.0.1:11434",
			},
		});
		expect(writes.join("")).toContain("Dev smoke eval passed.");
		expect(writes.join("")).toContain("Evidence: /tmp/evidence");
	});

	it("rejects cloud providers for smoke eval scoring", async () => {
		await expect(
			runDevSmokeEvalCommand({
				providerId: "anthropic",
				modelId: "claude-sonnet",
			}),
		).rejects.toThrow("local-only mode");
		expect(evalHarnessMocks.runClineDevSmokeEval).not.toHaveBeenCalled();
	});

	it("requires provider and model together when scoring a smoke eval", async () => {
		await expect(runDevSmokeEvalCommand({ providerId: "ollama" })).rejects.toThrow(
			"--provider-id and --model-id are required together",
		);
		expect(evalHarnessMocks.runClineDevSmokeEval).not.toHaveBeenCalled();
	});

	it("prints JSON output for automation", async () => {
		evalHarnessMocks.runClineDevSmokeEval.mockResolvedValue({
			workspacePath: "/tmp/workspace",
			evidenceBundlePath: "/tmp/evidence",
			acceptanceCommand: "npm test",
			passed: false,
			exitCode: 1,
			output: "failed",
		});
		const writes: string[] = [];

		await runDevSmokeEvalCommand({
			json: true,
			write: (text) => {
				writes.push(text);
			},
		});

		expect(writes).toHaveLength(1);
		expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
			passed: false,
			evidenceBundlePath: "/tmp/evidence",
		});
	});

	it("writes dogfood backlog artifacts", async () => {
		evalHarnessMocks.writeClineDogfoodBacklog.mockResolvedValue({
			rootPath: "/repo/.cline/nklein/plans/dogfood",
			taskGraph: {
				slug: "dogfood",
				tasks: [{ id: "task-1" }],
			},
		});
		const writes: string[] = [];

		await runDevDogfoodBacklogCommand({
			cwd: "/repo",
			projectPath: "/repo",
			telemetryRoot: "/telemetry",
			slug: "dogfood",
			suggestion: "Improve stalled task diagnostics.",
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.writeClineDogfoodBacklog).toHaveBeenCalledWith({
			workspacePath: "/repo",
			telemetryRootDir: "/telemetry",
			slug: "dogfood",
			userSuggestions: ["Improve stalled task diagnostics."],
		});
		expect(writes.join("")).toContain("task decompose --slug dogfood");
	});

	it("prints advisor prompt JSON", async () => {
		evalHarnessMocks.buildClineAdvisorRequest.mockReturnValue({
			kind: "model_freshness",
			title: "Check For Better Models",
			prompt: "Compare models",
			requiresWebResearch: true,
			recommendedSources: ["https://openrouter.ai/models"],
		});
		const writes: string[] = [];

		await runDevAdvisorPromptCommand({
			json: true,
			kind: "model_freshness",
			modelRegistrySummary: "worker qwen",
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.buildClineAdvisorRequest).toHaveBeenCalledWith("model_freshness", {
			workspacePath: undefined,
			repoSummary: undefined,
			modelRegistrySummary: "worker qwen",
			runtimeConfigSummary: undefined,
			telemetrySummary: undefined,
			taskSummary: undefined,
			userQuestion: undefined,
		});
		expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
			title: "Check For Better Models",
			requiresWebResearch: true,
		});
	});

	it("prints check-models prompt JSON", async () => {
		evalHarnessMocks.buildClineModelFreshnessAdvisorRequest.mockResolvedValue({
			kind: "model_freshness",
			title: "Check For Better Models",
			prompt: "Compare current roster",
			requiresWebResearch: true,
			recommendedSources: ["https://openrouter.ai/models"],
		});
		const writes: string[] = [];

		await runDevCheckModelsCommand({
			json: true,
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.buildClineModelFreshnessAdvisorRequest).toHaveBeenCalledTimes(1);
		expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
			title: "Check For Better Models",
			prompt: "Compare current roster",
		});
	});

	it("prints explicit advisor shortcut prompts", async () => {
		evalHarnessMocks.buildClineAdvisorRequest.mockReturnValue({
			kind: "mcp_discovery",
			title: "Find Useful MCP Plugins",
			prompt: "Research MCP",
			requiresWebResearch: true,
			recommendedSources: ["https://mcp.so/"],
		});
		const writes: string[] = [];

		await runDevAdvisorShortcutCommand("mcp_discovery", {
			json: true,
			repoSummary: "TypeScript app",
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.buildClineAdvisorRequest).toHaveBeenCalledWith("mcp_discovery", {
			workspacePath: undefined,
			repoSummary: "TypeScript app",
			modelRegistrySummary: undefined,
			runtimeConfigSummary: undefined,
			telemetrySummary: undefined,
			taskSummary: undefined,
			userQuestion: undefined,
		});
		expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
			title: "Find Useful MCP Plugins",
			requiresWebResearch: true,
		});
	});
});
