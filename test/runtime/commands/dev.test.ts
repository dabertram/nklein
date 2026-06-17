import { afterEach, describe, expect, it, vi } from "vitest";

const evalHarnessMocks = vi.hoisted(() => ({
	runClineDevSmokeEval: vi.fn(),
}));

vi.mock("../../../src/cline-sdk/cline-eval-harness", () => ({
	runClineDevSmokeEval: evalHarnessMocks.runClineDevSmokeEval,
}));

import { runDevSmokeEvalCommand } from "../../../src/commands/dev";

describe("dev command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		evalHarnessMocks.runClineDevSmokeEval.mockReset();
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
});
