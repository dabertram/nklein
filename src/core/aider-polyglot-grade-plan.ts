import type { AiderPolyglotLanguage, AiderPolyglotTask } from "./aider-polyglot-benchmark";
import type { BenchmarkAttemptStatus } from "./swebench-benchmark";

export interface AiderPolyglotGradeDockerPlan {
	setupSteps: readonly (readonly string[])[];
	testStep: readonly string[];
}

/**
 * Classify the trusted test step after every setup step has succeeded.
 *
 * Test runners do not share a failure exit code: unittest/Jest/Gradle normally use 1 while Cargo uses 101. Once the
 * pinned container has started and the trusted test command has run, every ordinary non-zero exit is model evidence,
 * not infrastructure evidence. Transport/spawn/timeout failures are reported separately by the Docker runner.
 */
export function classifyAiderPolyglotTestResult(input: {
	exitCode: number;
	infrastructureFailure: boolean;
}): BenchmarkAttemptStatus {
	if (input.infrastructureFailure) return "error";
	return input.exitCode === 0 ? "resolved" : "unresolved";
}

const GRADER_IMAGES: Readonly<Record<AiderPolyglotLanguage, string>> = {
	cpp: "nklein/aider-polyglot-cpp:1.0.0",
	go: "nklein/aider-polyglot-go:1.0.0",
	java: "nklein/aider-polyglot-java:1.0.0",
	javascript: "nklein/aider-polyglot-javascript:1.0.0",
	python: "nklein/agent-sandbox:0.0.1",
	rust: "nklein/aider-polyglot-rust:1.0.0",
};

function validateImage(value: string): void {
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(value)) {
		throw new Error("Aider polyglot grader image must use a semantic-version tag or immutable digest.");
	}
}

export function resolveAiderPolyglotGraderImage(language: AiderPolyglotLanguage, override?: string): string {
	const image = override ?? GRADER_IMAGES[language];
	validateImage(image);
	return image;
}

function validateAbsolutePath(value: string, name: string): void {
	if (!value.startsWith("/") || value.includes("\n") || value.includes("\0")) {
		throw new Error(`${name} must be a safe absolute path.`);
	}
}

function validateRelativePath(value: string, name: string): void {
	if (
		!value ||
		value.startsWith("/") ||
		value.includes("\\") ||
		value.includes("\n") ||
		value.includes("\0") ||
		value.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(`${name} must be a safe relative path.`);
	}
}

export function resolveAiderPolyglotCompanionExamplePath(solutionFile: string): string {
	validateRelativePath(solutionFile, "solutionFile");
	const filename = solutionFile.slice(solutionFile.lastIndexOf("/") + 1);
	const dot = filename.lastIndexOf(".");
	const stem = dot < 0 ? filename : filename.slice(0, dot);
	const extension = dot < 0 ? "" : filename.slice(dot);
	return `.meta/${stem}-example${extension}`;
}

function containerBase(input: {
	image: string;
	uid: number;
	gid: number;
	mounts: readonly string[];
	pidsLimit: number;
}): string[] {
	return [
		"run",
		"--rm",
		"--network",
		"none",
		"--read-only",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		String(input.pidsLimit),
		"--memory",
		"2g",
		"--memory-swap",
		"2g",
		"--cpus",
		"2",
		"--tmpfs",
		"/tmp:rw,noexec,nosuid,size=128m",
		"--user",
		`${input.uid}:${input.gid}`,
		"--env",
		"HOME=/tmp",
		"--workdir",
		"/grade",
		...input.mounts.flatMap((mount) => ["--volume", mount]),
		input.image,
	];
}

function appendToolchainSetup(
	setupSteps: string[][],
	common: readonly string[],
	language: AiderPolyglotLanguage,
	exercise: string,
	testFiles: readonly string[],
): readonly string[] {
	switch (language) {
		case "cpp":
			return [...common, "/usr/local/bin/aider-polyglot-test", exercise];
		case "go":
			setupSteps.push([...common, "mkdir", "-p", "/grade/.go-tmp"]);
			return [...common, "env", "GOTMPDIR=/grade/.go-tmp", "go", "test", "./..."];
		case "java":
			setupSteps.push([...common, "mkdir", "-p", "/grade/.gradle"]);
			setupSteps.push([...common, "cp", "-R", "/opt/gradle-cache/.", "/grade/.gradle"]);
			for (const testFile of testFiles) {
				setupSteps.push([...common, "sed", "-E", "-i", "-e", "s/@Disabled(\\([^)]*\\))?//g", `/grade/${testFile}`]);
			}
			return [...common, "gradle", "--offline", "--no-daemon", "--gradle-user-home", "/grade/.gradle", "test"];
		case "javascript":
			setupSteps.push([...common, "ln", "-s", "/opt/aider-polyglot/node_modules", "/grade/node_modules"]);
			for (const testFile of testFiles) {
				setupSteps.push([
					...common,
					"sed",
					"-i",
					"-e",
					"s/xtest(/test(/g",
					"-e",
					"s/xit(/it(/g",
					"-e",
					"s/test\\.skip(/test(/g",
					`/grade/${testFile}`,
				]);
			}
			return [...common, "npm", "run", "test", "--", "--runInBand"];
		case "python":
			return [...common, "python3", "-m", "unittest", "discover", "-s", "/grade", "-p", "*_test.py"];
		case "rust":
			setupSteps.push([...common, "mkdir", "-p", "/grade/.cargo"]);
			setupSteps.push([...common, "cp", "-R", "/opt/cargo-cache/.", "/grade/.cargo"]);
			return [
				...common,
				"env",
				"CARGO_HOME=/grade/.cargo",
				"CARGO_NET_OFFLINE=true",
				"cargo",
				"test",
				"--",
				"--include-ignored",
			];
	}
}

function resolveGoldCopies(
	solutionFiles: readonly string[],
	exampleFiles: readonly string[],
): readonly { example: string; solution: string }[] {
	if (exampleFiles.length === 0) throw new Error("Gold grading requires at least one official example file.");
	if (exampleFiles.length === solutionFiles.length) {
		return exampleFiles.map((example, index) => ({ example, solution: solutionFiles[index] }));
	}
	const unmatched = new Set(solutionFiles);
	return exampleFiles.map((example) => {
		const dot = example.lastIndexOf(".");
		const extension = dot < 0 ? "" : example.slice(dot);
		const matches = [...unmatched].filter((solution) => extension && solution.endsWith(extension));
		if (matches.length !== 1) {
			throw new Error(`Cannot map official example ${example} to exactly one solution file.`);
		}
		unmatched.delete(matches[0]);
		return { example, solution: matches[0] };
	});
}

/**
 * Build a networkless trusted-grader plan. The full exercise (including tests/examples) enters only this post-capture
 * directory. Candidate mode applies only solution-file hunks from the captured patch; gold mode substitutes official
 * example files for solutions. Language dependencies are preloaded in pinned images, so grading cannot reach a registry.
 */
export function buildAiderPolyglotGradeDockerPlan(input: {
	task: AiderPolyglotTask;
	corpusDir: string;
	gradeDir: string;
	image?: string;
	uid: number;
	gid: number;
	mode: "gold" | "candidate";
	candidatePatchPath?: string;
	exampleFiles?: readonly string[];
	testFiles?: readonly string[];
}): AiderPolyglotGradeDockerPlan {
	validateAbsolutePath(input.corpusDir, "corpusDir");
	validateAbsolutePath(input.gradeDir, "gradeDir");
	const image = resolveAiderPolyglotGraderImage(input.task.language, input.image);
	const gold = input.mode === "gold";
	const examples = input.exampleFiles ?? [];
	const testFiles = input.testFiles ?? [];
	for (const [index, path] of input.task.solutionFiles.entries())
		validateRelativePath(path, `solutionFiles[${index}]`);
	for (const [index, path] of examples.entries()) validateRelativePath(path, `exampleFiles[${index}]`);
	for (const [index, path] of testFiles.entries()) validateRelativePath(path, `testFiles[${index}]`);
	const goldCopies = gold ? resolveGoldCopies(input.task.solutionFiles, examples) : [];
	if (!gold && input.candidatePatchPath) validateAbsolutePath(input.candidatePatchPath, "candidatePatchPath");
	const exerciseDir = `${input.corpusDir}/${input.task.language}/exercises/practice/${input.task.exercise}`;
	const mounts = [`${exerciseDir}:/source:ro`, `${input.gradeDir}:/grade:rw`];
	if (input.candidatePatchPath) mounts.push(`${input.candidatePatchPath}:/prediction/model.patch:ro`);
	// The upstream C++ bank-account oracle intentionally starts 1,000 threads. Keep the wider bound scoped to C++;
	// every other grader retains the tighter process limit.
	const pidsLimit = input.task.language === "cpp" ? 2_048 : 256;
	const common = containerBase({ image, uid: input.uid, gid: input.gid, mounts, pidsLimit });
	const setupSteps: string[][] = [[...common, "cp", "-R", "/source/.", "/grade"]];
	if (gold) {
		for (const copy of goldCopies) {
			setupSteps.push([...common, "cp", `/source/${copy.example}`, `/grade/${copy.solution}`]);
		}
	} else if (input.candidatePatchPath) {
		setupSteps.push([
			...common,
			"git",
			"-C",
			"/grade",
			"apply",
			"--whitespace=nowarn",
			...input.task.solutionFiles.map((path) => `--include=${path}`),
			"/prediction/model.patch",
		]);
	}
	const testStep = appendToolchainSetup(setupSteps, common, input.task.language, input.task.exercise, testFiles);
	return { setupSteps, testStep };
}
