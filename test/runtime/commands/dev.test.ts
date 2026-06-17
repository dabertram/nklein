import { afterEach, describe, expect, it, vi } from "vitest";

const evalHarnessMocks = vi.hoisted(() => ({
	buildClineAdvisorRequest: vi.fn(),
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

import {
	runDevAdvisorPromptCommand,
	runDevDogfoodBacklogCommand,
	runDevSmokeEvalCommand,
} from "../../../src/commands/dev";

describe("dev command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		evalHarnessMocks.buildClineAdvisorRequest.mockReset();
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
			git: false,
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.runClineDevSmokeEval).toHaveBeenCalledWith({
			parentDir: "/tmp/workspaces",
			evidenceRootDir: "/tmp/evidence-root",
			initializeGit: false,
		});
		expect(writes.join("")).toContain("Dev smoke eval passed.");
		expect(writes.join("")).toContain("Evidence: /tmp/evidence");
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
			rootPath: "/repo/.cline/kanban/plans/dogfood",
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
			write: (text) => {
				writes.push(text);
			},
		});

		expect(evalHarnessMocks.writeClineDogfoodBacklog).toHaveBeenCalledWith({
			workspacePath: "/repo",
			telemetryRootDir: "/telemetry",
			slug: "dogfood",
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
});
