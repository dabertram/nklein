import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSwebenchInstance } from "../../../src/core/swebench-benchmark";
import { gradeLocalBenchmark } from "../../../src/workspace/local-benchmark-grade-runner";

const instance = parseSwebenchInstance(
	{
		instance_id: "local-owner-repo-1",
		repo: "owner/repo",
		base_commit: "0123456789abcdef",
		problem_statement: "Repair the implementation.",
		patch: "gold",
		test_patch: "",
		hints_text: "",
		FAIL_TO_PASS: ["local-oracle::test-command"],
		PASS_TO_PASS: ["local-oracle::baseline"],
		local_oracle: {
			image: "nklein-agent:0.1.0",
			test_command: "npm test",
			test_files: ["test/range.test.ts"],
			solution_files: ["src/range.ts"],
		},
	},
	"local_minted",
);

describe("local benchmark grade runner", () => {
	it("runs every setup step before classifying the held-out test", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-local-grade-"));
		const cache = join(root, "cache");
		const report = join(root, "report");
		await mkdir(cache);
		await mkdir(report);
		await writeFile(join(cache, "owner__repo.git"), "fixture");
		let calls = 0;
		const result = await gradeLocalBenchmark({
			instance,
			repoCacheDir: cache,
			workspaceParentDir: report,
			mode: "candidate",
			runDocker: async (args) => {
				calls += 1;
				if (args.includes("clone")) await mkdir(join(report, "grade-workspace"));
				return {
					exitCode: 0,
					stdout: "ok\n",
					stderr: "",
					infrastructureFailure: false,
				};
			},
		});
		expect(result.status).toBe("resolved");
		expect(result.log).toContain("held-out local oracle");
		expect(calls).toBeGreaterThan(3);
	});

	it("classifies an invalid candidate patch as unresolved without running the oracle", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-local-grade-invalid-"));
		const cache = join(root, "cache");
		const report = join(root, "report");
		const patch = join(report, "candidate.patch");
		await mkdir(cache);
		await mkdir(report);
		await writeFile(join(cache, "owner__repo.git"), "fixture");
		await writeFile(patch, "not a patch");
		const commands: string[] = [];
		const result = await gradeLocalBenchmark({
			instance,
			repoCacheDir: cache,
			workspaceParentDir: report,
			patchPath: patch,
			mode: "candidate",
			runDocker: async (args) => {
				commands.push(args.join(" "));
				if (args.includes("clone")) await mkdir(join(report, "grade-workspace"));
				return {
					exitCode: args.includes("--check") ? 1 : 0,
					stdout: "",
					stderr: args.includes("--check") ? "invalid" : "",
					infrastructureFailure: false,
				};
			},
		});
		expect(result.status).toBe("unresolved");
		expect(commands.some((command) => command.includes("-lc npm test"))).toBe(false);
	});
});
