import type { AiderPolyglotTask } from "./aider-polyglot-benchmark";

export interface AiderPolyglotGradeDockerPlan {
	setupSteps: readonly (readonly string[])[];
	testStep: readonly string[];
}

function validateAbsolutePath(value: string, name: string): void {
	if (!value.startsWith("/") || value.includes("\n") || value.includes("\0")) {
		throw new Error(`${name} must be a safe absolute path.`);
	}
}

function containerBase(input: { image: string; uid: number; gid: number; mounts: readonly string[] }): string[] {
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
		"256",
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
		...input.mounts.flatMap((mount) => ["--volume", mount]),
		input.image,
	];
}

/**
 * Build a networkless trusted-grader plan. The full exercise (including tests/examples) enters only this post-capture
 * directory. Candidate mode applies the captured patch; gold mode substitutes official example files for solutions.
 */
export function buildAiderPolyglotGradeDockerPlan(input: {
	task: AiderPolyglotTask;
	corpusDir: string;
	gradeDir: string;
	image: string;
	uid: number;
	gid: number;
	mode: "gold" | "candidate";
	candidatePatchPath?: string;
	exampleFiles?: readonly string[];
}): AiderPolyglotGradeDockerPlan {
	validateAbsolutePath(input.corpusDir, "corpusDir");
	validateAbsolutePath(input.gradeDir, "gradeDir");
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(input.image)) {
		throw new Error("Aider polyglot grader image must use a semantic-version tag or immutable digest.");
	}
	if (input.task.language !== "python") {
		throw new Error(`Aider polyglot grader image/toolchain is not yet configured for ${input.task.language}.`);
	}
	const gold = input.mode === "gold";
	const examples = input.exampleFiles ?? [];
	if (gold && examples.length !== input.task.solutionFiles.length) {
		throw new Error("Gold grading requires one official example file per solution file.");
	}
	if (!gold && input.candidatePatchPath) validateAbsolutePath(input.candidatePatchPath, "candidatePatchPath");
	const exerciseDir = `${input.corpusDir}/${input.task.language}/exercises/practice/${input.task.exercise}`;
	const mounts = [`${exerciseDir}:/source:ro`, `${input.gradeDir}:/grade:rw`];
	if (input.candidatePatchPath) mounts.push(`${input.candidatePatchPath}:/prediction/model.patch:ro`);
	const common = containerBase({ image: input.image, uid: input.uid, gid: input.gid, mounts });
	const setupSteps: string[][] = [[...common, "cp", "-R", "/source/.", "/grade"]];
	if (gold) {
		for (let index = 0; index < examples.length; index += 1) {
			setupSteps.push([...common, "cp", `/source/${examples[index]}`, `/grade/${input.task.solutionFiles[index]}`]);
		}
	} else if (input.candidatePatchPath) {
		setupSteps.push([...common, "git", "-C", "/grade", "apply", "--whitespace=nowarn", "/prediction/model.patch"]);
	}
	return {
		setupSteps,
		testStep: [...common, "python3", "-m", "unittest", "discover", "-s", "/grade", "-p", "*_test.py"],
	};
}
