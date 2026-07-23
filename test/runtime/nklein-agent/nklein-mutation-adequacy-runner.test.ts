import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { MutationAdequacyPlan, PlannedMutation } from "../../../src/core/mutation-adequacy-plan";
import { runNKleinMutationAdequacy } from "../../../src/nklein-agent/nklein-mutation-adequacy-runner";

const execFile = promisify(execFileCallback);

function candidate(index: number): PlannedMutation {
	return {
		path: "src/range.ts",
		line: index + 1,
		original: `return value > ${index};`,
		mutated: `return value >= ${index};`,
		operator: "gt_to_gte",
	};
}

function plan(count = 3): MutationAdequacyPlan {
	return {
		applicable: true,
		reason: `planned ${count} mutant(s)`,
		candidates: Array.from({ length: count }, (_, index) => candidate(index)),
		truncatedCandidates: 0,
	};
}

function fakeSandbox(testExitCodes: Array<number | null>, applyExitCodes: number[] = []) {
	let testIndex = 0;
	let applyIndex = 0;
	const assertAvailable = vi.fn(async () => undefined);
	const prepareWorkspace = vi.fn(async ({ taskId }: { taskId: string; baseRef?: string | null }) => ({
		workdir: `/workspaces/${taskId}`,
		uid: 1000,
	}));
	const exec = vi.fn(async (_taskId: string, argv: readonly string[]) => {
		if (argv[0] === "node") {
			return { exitCode: applyExitCodes[applyIndex++] ?? 0, stdout: "", stderr: "" };
		}
		const exitCode = testIndex < testExitCodes.length ? testExitCodes[testIndex] : 0;
		testIndex += 1;
		return { exitCode, stdout: exitCode === null ? "" : exitCode === 0 ? "green" : "red", stderr: "" };
	});
	const disposeWorkspace = vi.fn(async (_taskId: string) => undefined);
	return {
		manager: { assertAvailable, prepareWorkspace, exec, disposeWorkspace },
		assertAvailable,
		prepareWorkspace,
		exec,
		disposeWorkspace,
	};
}

describe("sandbox mutation adequacy runner", () => {
	it("applies the direct-argv line mutation protocol and runs the real shell command", async () => {
		const workspaces: string[] = [];
		const workspaceByTask = new Map<string, string>();
		const manager = {
			assertAvailable: vi.fn(async () => undefined),
			prepareWorkspace: vi.fn(async ({ taskId }: { taskId: string }) => {
				const workspace = await mkdtemp(join(tmpdir(), "nklein-mutation-runner-"));
				workspaces.push(workspace);
				workspaceByTask.set(taskId, workspace);
				await mkdir(join(workspace, "src"));
				await writeFile(
					join(workspace, "src", "flags.js"),
					"const flag1 = true;\r\nconst flag2 = true;\nconst flag3 = true;\n",
				);
				return { workdir: workspace, uid: 1000 };
			}),
			exec: vi.fn(async (taskId: string, argv: readonly string[]) => {
				try {
					const result = await execFile(argv[0] ?? "", [...argv.slice(1)], {
						cwd: workspaceByTask.get(taskId),
					});
					return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
				} catch (error) {
					const failure = error as { code?: number; stdout?: string; stderr?: string };
					return {
						exitCode: typeof failure.code === "number" ? failure.code : null,
						stdout: failure.stdout ?? "",
						stderr: failure.stderr ?? "",
					};
				}
			}),
			disposeWorkspace: vi.fn(async (taskId: string) => {
				const workspace = workspaceByTask.get(taskId);
				if (workspace) await rm(workspace, { recursive: true, force: true });
				workspaceByTask.delete(taskId);
			}),
		};
		const candidates = [1, 2, 3].map((line) => ({
			path: "src/flags.js",
			line,
			original: `const flag${line} = true;`,
			mutated: `const flag${line} = false;`,
			operator: "true_to_false",
		}));

		const result = await runNKleinMutationAdequacy({
			taskId: "task-real-protocol",
			projectRepoPath: "/repo",
			resultCommit: "abc123",
			taskPrompt:
				"Acceptance command: node -e \"const fs=require('fs');process.exit(fs.readFileSync('src/flags.js','utf8').includes('false')?1:0)\"",
			plan: { applicable: true, reason: "three flags", candidates, truncatedCandidates: 0 },
			sandboxManager: manager as never,
		});

		expect(result).toMatchObject({
			status: "measured",
			verdict: "adequate",
			score: 1,
			killedMutants: 3,
			survivedMutants: 0,
		});
		expect(manager.disposeWorkspace).toHaveBeenCalledTimes(3);
		expect(workspaces).toHaveLength(3);
	});

	it("uses a fresh result-commit workspace per mutant and scores killed versus survived", async () => {
		const sandbox = fakeSandbox([1, 0, 1]);
		const result = await runNKleinMutationAdequacy({
			taskId: "task-1",
			projectRepoPath: "/repo",
			resultCommit: "abc123",
			taskPrompt: "Repair the range.\nAcceptance command: npm test",
			plan: plan(),
			sandboxManager: sandbox.manager as never,
		});

		expect(result).toMatchObject({
			status: "measured",
			verdict: "adequate",
			score: 2 / 3,
			runMutants: 3,
			killedMutants: 2,
			survivedMutants: 1,
			errorMutants: 0,
			infrastructureFailure: null,
		});
		expect(sandbox.prepareWorkspace).toHaveBeenCalledTimes(3);
		expect(sandbox.prepareWorkspace.mock.calls.map(([input]) => input.baseRef)).toEqual([
			"abc123",
			"abc123",
			"abc123",
		]);
		const taskIds = sandbox.prepareWorkspace.mock.calls.map(([input]) => input.taskId);
		expect(new Set(taskIds).size).toBe(3);
		expect(sandbox.disposeWorkspace.mock.calls.map(([taskId]) => taskId)).toEqual(taskIds);
	});

	it("rewrites a stale sandbox cd prefix to each fresh mutant workspace", async () => {
		const sandbox = fakeSandbox([1, 1, 1]);
		await runNKleinMutationAdequacy({
			taskId: "task-2",
			projectRepoPath: "/repo",
			resultCommit: "def456",
			taskPrompt: "Acceptance check: cd /workspaces/old-task/subproject && npm test",
			plan: plan(),
			sandboxManager: sandbox.manager as never,
		});

		const shellCalls = sandbox.exec.mock.calls.filter(([, argv]) => argv[0] !== "node");
		expect(shellCalls).toHaveLength(3);
		for (const [taskId, argv] of shellCalls) {
			expect(argv.join(" ")).toContain(`/workspaces/${taskId}/subproject`);
			expect(argv.join(" ")).not.toContain("/workspaces/old-task");
		}
	});

	it("stops on transport failure and refuses to report a partial mutation verdict", async () => {
		const sandbox = fakeSandbox([1, null, 0, 0]);
		const result = await runNKleinMutationAdequacy({
			taskId: "task-3",
			projectRepoPath: "/repo",
			resultCommit: "abc123",
			taskPrompt: "Acceptance command: npm test",
			plan: plan(4),
			sandboxManager: sandbox.manager as never,
		});

		expect(result.status).toBe("unmeasured");
		expect(result.verdict).toBe("unmeasured");
		expect(result.infrastructureFailure).toContain("mutation test transport failed");
		expect(result.killedMutants).toBe(1);
		expect(result.runMutants).toBe(1);
		expect(sandbox.prepareWorkspace).toHaveBeenCalledTimes(2);
		expect(sandbox.disposeWorkspace).toHaveBeenCalledTimes(2);
	});

	it("records mutation-application errors without counting them as killed", async () => {
		const sandbox = fakeSandbox([1, 0], [2, 0, 0]);
		const result = await runNKleinMutationAdequacy({
			taskId: "task-4",
			projectRepoPath: "/repo",
			resultCommit: "abc123",
			taskPrompt: "Acceptance command: npm test",
			plan: plan(),
			sandboxManager: sandbox.manager as never,
		});

		expect(result).toMatchObject({
			status: "unmeasured",
			verdict: "unmeasured",
			runMutants: 2,
			killedMutants: 1,
			survivedMutants: 1,
			errorMutants: 1,
			score: 0.5,
		});
	});

	it("does not consume sandbox capacity when there is no persisted acceptance command", async () => {
		const sandbox = fakeSandbox([]);
		const result = await runNKleinMutationAdequacy({
			taskId: "task-5",
			projectRepoPath: "/repo",
			resultCommit: "abc123",
			taskPrompt: "Repair the range safely.",
			plan: plan(),
			sandboxManager: sandbox.manager as never,
		});

		expect(result).toMatchObject({ status: "unmeasured", command: null, runMutants: 0 });
		expect(sandbox.assertAvailable).not.toHaveBeenCalled();
		expect(sandbox.prepareWorkspace).not.toHaveBeenCalled();
	});
});
