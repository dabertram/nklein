import { describe, expect, it } from "vitest";
import {
	buildAiderPolyglotTask,
	PINNED_AIDER_POLYGLOT_COMMIT,
	parseAiderPolyglotConfig,
	parseAiderPolyglotManifest,
} from "../../../src/core/aider-polyglot-benchmark";
import { buildAiderPolyglotGradeDockerPlan } from "../../../src/core/aider-polyglot-grade-plan";
import { buildAiderPolyglotWorkspaceDockerPlan } from "../../../src/core/aider-polyglot-workspace-plan";

const config = JSON.stringify({
	files: { solution: ["src/lib.rs", "Cargo.toml"], test: ["tests/private.rs"], example: [".meta/example.rs"] },
});

describe("Aider polyglot benchmark adapter", () => {
	it("builds a public task without test or example paths", () => {
		const task = buildAiderPolyglotTask({
			language: "rust",
			exercise: "decimal",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: config,
			instructionParts: ["# Instructions", "Implement a decimal type."],
		});
		expect(task.instanceId).toBe("aider-rust-decimal");
		expect(task.prompt).toContain("src/lib.rs, Cargo.toml");
		expect(JSON.stringify(task)).not.toContain("private.rs");
		expect(JSON.stringify(task)).not.toContain("example.rs");
		expect(
			parseAiderPolyglotManifest({
				schemaVersion: 1,
				corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
				tasks: [task],
			}),
		).toEqual({ schemaVersion: 1, corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT, tasks: [task] });
	});

	it("rejects traversal, duplicate paths, inconsistent ids, and malformed configs", () => {
		expect(() =>
			parseAiderPolyglotConfig(JSON.stringify({ files: { solution: ["../answer.py"], test: [] } })),
		).toThrow(/unsafe relative path/);
		expect(() =>
			parseAiderPolyglotConfig(JSON.stringify({ files: { solution: ["answer.py", "answer.py"], test: [] } })),
		).toThrow(/duplicate/);
		expect(() => parseAiderPolyglotConfig("not-json")).toThrow(/invalid JSON/);
		const task = buildAiderPolyglotTask({
			language: "python",
			exercise: "pov",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: JSON.stringify({ files: { solution: ["pov.py"], test: ["pov_test.py"] } }),
			instructionParts: ["Do the work."],
		});
		expect(() =>
			parseAiderPolyglotManifest({
				schemaVersion: 1,
				corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
				tasks: [{ ...task, instanceId: "wrong" }],
			}),
		).toThrow(/inconsistent/);
	});

	it("copies only solution files through argv-only networkless Docker steps", () => {
		const task = buildAiderPolyglotTask({
			language: "rust",
			exercise: "decimal",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: config,
			instructionParts: ["Implement it."],
		});
		const plan = buildAiderPolyglotWorkspaceDockerPlan({
			task,
			corpusDir: "/corpus",
			workspaceParentDir: "/workspaces",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 501,
			gid: 20,
		});
		expect(plan.steps).toHaveLength(task.solutionFiles.length + 4);
		expect(plan.steps.every((step) => step.includes("none"))).toBe(true);
		const argv = plan.steps.flat().join("\n");
		expect(argv).toContain("src/lib.rs");
		expect(argv).toContain("Cargo.toml");
		expect(argv).toContain("$a.nklein/");
		expect(argv).not.toContain("private.rs");
		expect(argv).not.toContain("example.rs");
		expect(argv).not.toContain("sh\n-c");
	});

	it("keeps tests in a separate post-capture grader and supports candidate and gold modes", () => {
		const task = buildAiderPolyglotTask({
			language: "python",
			exercise: "pov",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: JSON.stringify({ files: { solution: ["pov.py"], test: ["pov_test.py"] } }),
			instructionParts: ["Implement it."],
		});
		const candidate = buildAiderPolyglotGradeDockerPlan({
			task,
			corpusDir: "/corpus",
			gradeDir: "/reports/grade",
			candidatePatchPath: "/reports/model.patch",
			mode: "candidate",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 501,
			gid: 20,
		});
		expect(candidate.setupSteps.flat().join("\n")).toContain("git\n-C\n/grade\napply");
		expect(candidate.testStep.join("\n")).toContain("*_test.py");
		expect(candidate.testStep).toContain("none");
		const gold = buildAiderPolyglotGradeDockerPlan({
			task,
			corpusDir: "/corpus",
			gradeDir: "/reports/gold",
			exampleFiles: [".meta/example.py"],
			mode: "gold",
			image: "nklein/agent-sandbox:0.0.1",
			uid: 501,
			gid: 20,
		});
		expect(gold.setupSteps.flat().join("\n")).toContain(".meta/example.py");
		expect(gold.setupSteps.flat().join("\n")).toContain("/grade/pov.py");
	});
});
