import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseSwebenchDataset } from "../../../src/core/swebench-benchmark";
import { mintLocalBenchmarkTasks } from "../../../src/workspace/local-benchmark-mint-runner";

const execFile = promisify(execFileCallback);

describe("local benchmark mint runner", () => {
	it("turns killed local mutations into a sealed mirror plus oracle-bearing dataset", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-local-mint-test-"));
		const repo = join(root, "repo");
		const cache = join(root, "cache");
		const output = join(root, "dataset.json");
		await mkdir(join(repo, "src"), { recursive: true });
		await mkdir(join(repo, "test"), { recursive: true });
		await writeFile(
			join(repo, "src", "range.ts"),
			"function allowed(value: number) {\n\treturn value >= 1 && value < 4;\n}\nexport { allowed };\n",
		);
		await writeFile(join(repo, "test", "range.test.ts"), "// protected oracle\n");
		await execFile("git", ["init", "--initial-branch=main"], { cwd: repo });
		await execFile("git", ["add", "--all"], { cwd: repo });
		await execFile("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "base"], {
			cwd: repo,
		});
		let calls = 0;
		const result = await mintLocalBenchmarkTasks(
			{
				repoPath: repo,
				repoName: "local/range",
				implementationFiles: ["src/range.ts"],
				testFiles: ["test/range.test.ts"],
				testCommand: "node test.js",
				image: "nklein-agent:0.1.0",
				repoCacheDir: cache,
				outputPath: output,
				maxMutants: 1,
			},
			{
				runTest: async () => {
					calls += 1;
					return { exitCode: calls === 1 ? 0 : 1, stdout: "", stderr: "", infrastructureFailure: false };
				},
			},
		);
		expect(result.validMutants).toBe(1);
		const text = await readFile(output, "utf8");
		const instances = parseSwebenchDataset(text, "local_minted");
		expect(instances).toHaveLength(1);
		expect(instances[0].localOracle).toEqual({
			image: "nklein-agent:0.1.0",
			testCommand: "node test.js",
			testFiles: ["test/range.test.ts"],
			solutionFiles: ["src/range.ts"],
		});
		expect(instances[0].problemStatement).not.toContain("value >= 1");
		expect(instances[0].goldPatch).toContain("src/range.ts");
		expect(
			await execFile("git", ["cat-file", "-t", instances[0].baseCommit], { cwd: result.mirrorPath }),
		).toMatchObject({
			stdout: "commit\n",
		});
		await expect(
			mintLocalBenchmarkTasks(
				{
					repoPath: repo,
					repoName: "local/escape",
					implementationFiles: ["../outside.ts"],
					testFiles: ["test/range.test.ts"],
					testCommand: "node test.js",
					image: "nklein-agent:0.1.0",
					repoCacheDir: join(root, "escape-cache"),
					outputPath: join(root, "escape.json"),
				},
				{ runTest: async () => ({ exitCode: 0, stdout: "", stderr: "", infrastructureFailure: false }) },
			),
		).rejects.toThrow(/safe repository-relative file path/);
	});

	it("rejects a test command that rewrites tracked repository state", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-local-mint-mutating-test-"));
		const repo = join(root, "repo");
		await mkdir(join(repo, "src"), { recursive: true });
		await mkdir(join(repo, "test"), { recursive: true });
		await writeFile(
			join(repo, "src", "range.ts"),
			"function allowed(value: number) {\n\treturn value >= 1 && value < 4;\n}\nexport { allowed };\n",
		);
		await writeFile(join(repo, "test", "range.test.ts"), "// protected oracle\n");
		await execFile("git", ["init", "--initial-branch=main"], { cwd: repo });
		await execFile("git", ["add", "--all"], { cwd: repo });
		await execFile("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "base"], {
			cwd: repo,
		});
		let calls = 0;
		await expect(
			mintLocalBenchmarkTasks(
				{
					repoPath: repo,
					repoName: "local/mutating-test",
					implementationFiles: ["src/range.ts"],
					testFiles: ["test/range.test.ts"],
					testCommand: "node test.js",
					image: "nklein-agent:0.1.0",
					repoCacheDir: join(root, "cache"),
					outputPath: join(root, "dataset.json"),
					maxMutants: 1,
				},
				{
					runTest: async (workspace) => {
						calls += 1;
						if (calls > 1)
							await writeFile(join(workspace, "test", "range.test.ts"), "test command rewrote test\n");
						return { exitCode: calls === 1 ? 0 : 1, stdout: "", stderr: "", infrastructureFailure: false };
					},
				},
			),
		).rejects.toThrow(/mutated tracked repository state outside the intended mutant/);
	});
});
