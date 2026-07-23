import { describe, expect, it } from "vitest";
import {
	buildLocalBenchmarkGradeDockerPlan,
	classifyLocalBenchmarkTestResult,
} from "../../../src/core/local-benchmark-grade-plan";
import { parseSwebenchInstance } from "../../../src/core/swebench-benchmark";

const instance = parseSwebenchInstance(
	{
		instance_id: "local-owner-repo-1",
		repo: "owner/repo",
		base_commit: "0123456789abcdef",
		problem_statement: "Repair the implementation without changing tests.",
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

describe("local benchmark grade plan", () => {
	it("applies predictions only in a fresh networkless clone and restores protected tests", () => {
		const plan = buildLocalBenchmarkGradeDockerPlan({
			instance,
			repoCacheDir: "/cache",
			workspaceParentDir: "/report",
			patchPath: "/report/candidate.patch",
			mode: "candidate",
			uid: 501,
			gid: 20,
		});
		const commands = plan.setupSteps.map((step) => step.args.join(" "));
		expect(commands.every((command) => command.includes("--network none"))).toBe(true);
		expect(commands.some((command) => command.includes("git apply --check"))).toBe(true);
		expect(commands.some((command) => command.includes("--include=src/range.ts"))).toBe(true);
		expect(commands.some((command) => command.includes("git checkout HEAD -- test/range.test.ts"))).toBe(true);
		expect(commands.some((command) => command.includes("git diff --exit-code HEAD -- test/range.test.ts"))).toBe(
			true,
		);
		expect(plan.setupSteps.find((step) => step.label === "validate prediction patch")?.failureStatus).toBe(
			"unresolved",
		);
		expect(plan.testStep.slice(-3)).toEqual(["/bin/sh", "-lc", "npm test"]);
	});

	it("treats trusted test failures as model evidence and transport failures as infrastructure errors", () => {
		expect(classifyLocalBenchmarkTestResult({ exitCode: 0, infrastructureFailure: false })).toBe("resolved");
		expect(classifyLocalBenchmarkTestResult({ exitCode: 101, infrastructureFailure: false })).toBe("unresolved");
		expect(classifyLocalBenchmarkTestResult({ exitCode: 1, infrastructureFailure: true })).toBe("error");
	});

	it("rejects missing or unsafe oracle boundaries", () => {
		if (!instance.localOracle) throw new Error("test fixture requires a local oracle");
		const unsafe = { ...instance, localOracle: { ...instance.localOracle, testFiles: ["../hidden.test.ts"] } };
		expect(() =>
			buildLocalBenchmarkGradeDockerPlan({
				instance: unsafe,
				repoCacheDir: "/cache",
				workspaceParentDir: "/report",
				mode: "candidate",
				uid: 501,
				gid: 20,
			}),
		).toThrow(/safe relative path/);
		const overlap = {
			...instance,
			localOracle: { ...instance.localOracle, solutionFiles: ["test/range.test.ts"] },
		};
		expect(() =>
			buildLocalBenchmarkGradeDockerPlan({
				instance: overlap,
				repoCacheDir: "/cache",
				workspaceParentDir: "/report",
				mode: "candidate",
				uid: 501,
				gid: 20,
			}),
		).toThrow(/must not overlap/);
	});
});
