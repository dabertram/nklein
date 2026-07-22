import { describe, expect, it } from "vitest";
import { parseSwebenchInstance } from "../../../src/core/swebench-benchmark";
import { buildSwebenchWorkspaceDockerPlan } from "../../../src/core/swebench-workspace-plan";

const instance = parseSwebenchInstance({
	instance_id: "owner__repo-1",
	repo: "owner/repo",
	base_commit: "0123456789abcdef",
	problem_statement: "Fix it.",
	patch: "gold",
	test_patch: "diff --git a/test.py b/test.py\n+assert fixed",
	hints_text: "secret",
	FAIL_TO_PASS: ["test::new"],
	PASS_TO_PASS: ["test::old"],
});

describe("SWE-bench workspace Docker plan", () => {
	it("keeps every mutation networkless, argv-only, resource-bounded and version-pinned", () => {
		const plan = buildSwebenchWorkspaceDockerPlan({
			instance,
			repoCacheDir: "/cache",
			workspaceParentDir: "/workspaces",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 501,
			gid: 20,
		});
		expect(plan.repositoryMirrorName).toBe("owner__repo.git");
		expect(plan.steps).toHaveLength(6);
		for (const step of plan.steps) {
			expect(step.slice(0, 5)).toEqual(["run", "--rm", "--network", "none", "--read-only"]);
			expect(step).toContain("--memory-swap");
			expect(step).toContain("no-new-privileges");
			expect(step).not.toContain("sh");
			expect(step).not.toContain("bash");
		}
		expect(plan.steps.flat().join("\n")).not.toContain("test.patch");
		expect(plan.steps.flat().join("\n")).not.toContain(instance.testPatch);
	});

	it("removes upstream history before creating the visible one-commit baseline", () => {
		const plan = buildSwebenchWorkspaceDockerPlan({
			instance: { ...instance, testPatch: "" },
			repoCacheDir: "/cache",
			workspaceParentDir: "/workspaces",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 1,
			gid: 1,
		});
		const commands = plan.steps.map((step) => step.slice(step.indexOf("nklein/agent-sandbox:0.0.1") + 1));
		expect(commands).toContainEqual(["rm", "-rf", "/workspace/.git"]);
		expect(commands.some((command) => command.includes("--initial-branch=benchmark-baseline"))).toBe(true);
		expect(commands.filter((command) => command.includes("commit"))).toHaveLength(1);
	});

	it("rejects unsafe repo, commit and mutable image identifiers", () => {
		const base = {
			instance,
			repoCacheDir: "/cache",
			workspaceParentDir: "/workspaces",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 1,
			gid: 1,
		};
		expect(() =>
			buildSwebenchWorkspaceDockerPlan({ ...base, instance: { ...instance, repo: "owner/repo;evil" } }),
		).toThrow(/owner\/name/);
		expect(() =>
			buildSwebenchWorkspaceDockerPlan({ ...base, instance: { ...instance, baseCommit: "HEAD~1" } }),
		).toThrow(/hexadecimal/);
		expect(() => buildSwebenchWorkspaceDockerPlan({ ...base, image: "nklein/agent-sandbox:latest" })).toThrow(
			/never latest/,
		);
	});
});
