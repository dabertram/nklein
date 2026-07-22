import { describe, expect, it } from "vitest";
import {
	buildAiderPolyglotExecutionPrompt,
	buildAiderPolyglotPublicAcceptanceCommand,
	buildAiderPolyglotTask,
	PINNED_AIDER_POLYGLOT_COMMIT,
	parseAiderPolyglotConfig,
	parseAiderPolyglotManifest,
} from "../../../src/core/aider-polyglot-benchmark";
import {
	buildAiderPolyglotGradeDockerPlan,
	classifyAiderPolyglotTestResult,
	resolveAiderPolyglotCompanionExamplePath,
	resolveAiderPolyglotGraderImage,
} from "../../../src/core/aider-polyglot-grade-plan";
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
		expect(buildAiderPolyglotPublicAcceptanceCommand(task)).toBe(
			"git diff --check -- 'src/lib.rs' 'Cargo.toml' && test -s 'src/lib.rs' && test -s 'Cargo.toml'",
		);
		expect(buildAiderPolyglotExecutionPrompt(task)).toContain(
			"Acceptance check: git diff --check -- 'src/lib.rs' 'Cargo.toml'",
		);
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
		expect(candidate.setupSteps.flat()).toContain("--include=pov.py");
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

	it.each([
		{
			language: "cpp" as const,
			solution: "answer.cpp",
			test: "answer_test.cpp",
			example: ".meta/example.cpp",
			image: "nklein/aider-polyglot-cpp:1.0.0",
			command: "/usr/local/bin/aider-polyglot-test",
			setup: undefined,
		},
		{
			language: "go" as const,
			solution: "answer.go",
			test: "answer_test.go",
			example: ".meta/example.go",
			image: "golang@sha256:1699c10032ca2582ec89a24a1312d986a3f094aed3d5c1147b19880afe40e052",
			command: "env\nGOTMPDIR=/grade/.go-tmp\ngo\ntest\n./...",
			setup: undefined,
		},
		{
			language: "java" as const,
			solution: "src/main/java/Answer.java",
			test: "src/test/java/AnswerTest.java",
			example: ".meta/src/reference/java/Answer.java",
			image: "nklein/aider-polyglot-java:1.0.0",
			command: "gradle\n--offline\n--no-daemon",
			setup: "s/@Disabled",
		},
		{
			language: "javascript" as const,
			solution: "answer.js",
			test: "answer.spec.js",
			example: ".meta/example.js",
			image: "nklein/aider-polyglot-javascript:1.0.0",
			command: "npm\nrun\ntest\n--\n--runInBand",
			setup: "/opt/aider-polyglot/node_modules",
		},
		{
			language: "python" as const,
			solution: "answer.py",
			test: "answer_test.py",
			example: ".meta/example.py",
			image: "nklein/agent-sandbox:0.0.1",
			command: "python3\n-m\nunittest\ndiscover",
			setup: undefined,
		},
		{
			language: "rust" as const,
			solution: "src/lib.rs",
			test: "tests/answer.rs",
			example: ".meta/example.rs",
			image: "nklein/aider-polyglot-rust:1.0.0",
			command: "CARGO_NET_OFFLINE=true\ncargo\ntest\n--\n--include-ignored",
			setup: "/opt/cargo-cache/.",
		},
	])("builds a pinned, networkless $language grader", ({
		language,
		solution,
		test,
		example,
		image,
		command,
		setup,
	}) => {
		const task = buildAiderPolyglotTask({
			language,
			exercise: "answer",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: JSON.stringify({ files: { solution: [solution], test: [test], example: [example] } }),
			instructionParts: ["Implement it."],
		});
		const plan = buildAiderPolyglotGradeDockerPlan({
			task,
			corpusDir: "/corpus",
			gradeDir: "/reports/gold",
			exampleFiles: [example],
			testFiles: [test],
			mode: "gold",
			uid: 501,
			gid: 20,
		});
		expect(resolveAiderPolyglotGraderImage(language)).toBe(image);
		expect(plan.testStep.join("\n")).toContain(command);
		expect([...plan.setupSteps, plan.testStep].every((step) => step.includes("none"))).toBe(true);
		expect([...plan.setupSteps, plan.testStep].every((step) => step.includes(image))).toBe(true);
		expect(plan.testStep).toContain(language === "cpp" ? "2048" : "256");
		if (setup) expect(plan.setupSteps.flat().join("\n")).toContain(setup);
	});

	it("maps a partial gold reference set by unique extension and leaves build metadata intact", () => {
		const task = buildAiderPolyglotTask({
			language: "rust",
			exercise: "accumulate",
			corpusCommit: PINNED_AIDER_POLYGLOT_COMMIT,
			configText: JSON.stringify({
				files: {
					solution: ["src/lib.rs", "Cargo.toml"],
					test: ["tests/accumulate.rs"],
					example: [".meta/example.rs"],
				},
			}),
			instructionParts: ["Implement it."],
		});
		const plan = buildAiderPolyglotGradeDockerPlan({
			task,
			corpusDir: "/corpus",
			gradeDir: "/reports/gold",
			exampleFiles: [".meta/example.rs"],
			testFiles: ["tests/accumulate.rs"],
			mode: "gold",
			uid: 501,
			gid: 20,
		});
		const setup = plan.setupSteps.flat().join("\n");
		expect(setup).toContain("/grade/src/lib.rs");
		expect(setup).not.toContain("/grade/Cargo.toml");
		expect(resolveAiderPolyglotCompanionExamplePath("Cargo.toml")).toBe(".meta/Cargo-example.toml");
	});

	it("rejects floating grader image tags", () => {
		expect(() => resolveAiderPolyglotGraderImage("python", "python:latest")).toThrow(/semantic-version tag/);
	});

	it("classifies language-specific test exits as unresolved rather than infrastructure errors", () => {
		expect(classifyAiderPolyglotTestResult({ exitCode: 0, infrastructureFailure: false })).toBe("resolved");
		expect(classifyAiderPolyglotTestResult({ exitCode: 1, infrastructureFailure: false })).toBe("unresolved");
		// Cargo's ordinary failing-test exit is 101, not 1.
		expect(classifyAiderPolyglotTestResult({ exitCode: 101, infrastructureFailure: false })).toBe("unresolved");
		expect(classifyAiderPolyglotTestResult({ exitCode: 1, infrastructureFailure: true })).toBe("error");
	});
});
