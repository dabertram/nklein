import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { createGitProcessEnv } from "../core/git-process-env";
import {
	localBenchmarkProblemStatement,
	PINNED_SWE_SMITH_COMMIT,
	planLocalBenchmarkMutations,
} from "../core/local-benchmark-mint";
import { repositoryMirrorName } from "../core/swebench-workspace-plan";

const execFile = promisify(execFileCallback);

export interface LocalBenchmarkTestResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	infrastructureFailure: boolean;
}

export interface LocalBenchmarkMintInput {
	repoPath: string;
	repoName: string;
	implementationFiles: readonly string[];
	testFiles: readonly string[];
	testCommand: string;
	image: string;
	repoCacheDir: string;
	outputPath: string;
	maxMutants?: number;
}

export interface LocalBenchmarkMintDeps {
	runTest?: (workspacePath: string, image: string, testCommand: string) => Promise<LocalBenchmarkTestResult>;
}

async function command(
	command: string,
	args: readonly string[],
	cwd?: string,
	env?: NodeJS.ProcessEnv,
): Promise<string> {
	const result = await execFile(command, [...args], {
		cwd,
		env: command === "git" ? createGitProcessEnv(env) : env,
		maxBuffer: 32 * 1024 * 1024,
	});
	return result.stdout.trim();
}

async function runDockerTest(
	workspacePath: string,
	image: string,
	testCommand: string,
): Promise<LocalBenchmarkTestResult> {
	try {
		const result = await execFile(
			"docker",
			[
				"run",
				"--rm",
				"--network",
				"none",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--cpus",
				"2",
				"--memory",
				"2g",
				"--memory-swap",
				"2g",
				"--pids-limit",
				"256",
				"--tmpfs",
				"/tmp:rw,noexec,nosuid,size=256m",
				"--user",
				`${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
				"--env",
				"HOME=/tmp",
				"--mount",
				`type=bind,src=${workspacePath},dst=/workspace`,
				"--workdir",
				"/workspace",
				image,
				"/bin/sh",
				"-lc",
				testCommand,
			],
			{ timeout: 20 * 60_000, maxBuffer: 32 * 1024 * 1024 },
		);
		return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, infrastructureFailure: false };
	} catch (error) {
		const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
		const exitCode = typeof failure.code === "number" ? failure.code : 1;
		return {
			exitCode,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message,
			infrastructureFailure: typeof failure.code !== "number" || exitCode >= 125,
		};
	}
}

function assertPinnedImage(image: string): void {
	if (!/(@sha256:[0-9a-f]{64}|:\d+\.\d+\.\d+)$/iu.test(image)) {
		throw new Error("Local benchmark mint image must use a semantic-version tag or immutable digest.");
	}
}

function replaceLine(source: string, line: number, replacement: string): string {
	const lines = source.split("\n");
	if (line < 1 || line > lines.length) throw new Error(`Mutation line ${line} is outside the source file.`);
	lines[line - 1] = replacement;
	return lines.join("\n");
}

function validateRelativeFilePath(path: string, label: string): void {
	if (
		!path ||
		isAbsolute(path) ||
		path.includes("\\") ||
		path.includes("\n") ||
		path.includes("\0") ||
		path.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error(`${label} must be a safe repository-relative file path.`);
	}
}

async function resolveSelectedFile(repoPath: string, path: string, label: string): Promise<string> {
	validateRelativeFilePath(path, label);
	const lexical = resolve(repoPath, path);
	const resolved = await realpath(lexical);
	const fromRepo = relative(repoPath, resolved);
	if (fromRepo.startsWith("..") || isAbsolute(fromRepo) || resolved !== lexical) {
		throw new Error(`${label} must resolve directly inside the source repository without symlinks.`);
	}
	const metadata = await lstat(resolved);
	if (!metadata.isFile()) throw new Error(`${label} must identify a regular file.`);
	return resolved;
}

async function pathExists(path: string): Promise<boolean> {
	return lstat(path)
		.then(() => true)
		.catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return false;
			throw error;
		});
}

async function assertTestRepositoryState(
	workspacePath: string,
	expectedHead: string,
	expectedChangedFiles: readonly string[],
): Promise<void> {
	const head = await command("git", ["rev-parse", "HEAD"], workspacePath);
	if (head !== expectedHead) throw new Error("Declared test command changed repository history.");
	const changedText = await command("git", ["diff", "--name-only", "--no-ext-diff"], workspacePath);
	const changedFiles = changedText ? changedText.split("\n").sort() : [];
	const expected = [...expectedChangedFiles].sort();
	if (changedFiles.join("\n") !== expected.join("\n")) {
		throw new Error("Declared test command mutated tracked repository state outside the intended mutant.");
	}
}

export async function mintLocalBenchmarkTasks(
	input: LocalBenchmarkMintInput,
	deps: LocalBenchmarkMintDeps = {},
): Promise<{ outputPath: string; mirrorPath: string; sourceCommit: string; validMutants: number }> {
	let repoPath = resolve(input.repoPath);
	const repoCacheDir = resolve(input.repoCacheDir);
	const outputPath = resolve(input.outputPath);
	if (!isAbsolute(input.repoPath) || !isAbsolute(input.repoCacheDir) || !isAbsolute(input.outputPath)) {
		throw new Error("Local benchmark repo, cache, and output paths must be absolute.");
	}
	repoPath = await realpath(repoPath);
	if (!input.testCommand.trim()) throw new Error("Local benchmark mint requires a non-empty test command.");
	const protectedFiles = new Set(input.testFiles);
	if (input.implementationFiles.some((path) => protectedFiles.has(path))) {
		throw new Error("Local benchmark implementation files and protected test files must not overlap.");
	}
	assertPinnedImage(input.image);
	if ((await command("git", ["status", "--porcelain=v1"], repoPath)) !== "") {
		throw new Error("Local benchmark source repository must be clean.");
	}
	const sourceCommit = await command("git", ["rev-parse", "HEAD"], repoPath);
	const sourceDate = await command("git", ["show", "-s", "--format=%cI", sourceCommit], repoPath);
	const files = await Promise.all(
		input.implementationFiles.map(async (path, index) => ({
			path,
			source: await readFile(await resolveSelectedFile(repoPath, path, `implementationFiles[${index}]`), "utf8"),
		})),
	);
	for (const [index, testFile] of input.testFiles.entries()) {
		await resolveSelectedFile(repoPath, testFile, `testFiles[${index}]`);
	}
	const candidates = planLocalBenchmarkMutations({
		files,
		testFiles: input.testFiles,
		maxMutants: input.maxMutants,
	});
	if (candidates.length === 0) throw new Error("No bounded mutation candidates were found in the selected files.");
	const root = await mkdtemp(join(tmpdir(), "nklein-local-mint-"));
	const mirrorName = repositoryMirrorName(input.repoName);
	const mirrorPath = join(repoCacheDir, mirrorName);
	const runTest = deps.runTest ?? runDockerTest;
	let publishRoot: string | null = null;
	try {
		if (await pathExists(outputPath))
			throw new Error(`Refusing to replace existing local benchmark dataset: ${outputPath}`);
		if (await pathExists(mirrorPath))
			throw new Error(`Refusing to replace existing local benchmark mirror: ${mirrorPath}`);
		await mkdir(repoCacheDir, { recursive: true });
		publishRoot = await mkdtemp(join(repoCacheDir, ".nklein-local-mint-"));
		const stagedMirror = join(publishRoot, mirrorName);
		const baseline = join(root, "baseline");
		await command("git", ["clone", "--quiet", "--no-hardlinks", repoPath, baseline]);
		const baselineResult = await runTest(baseline, input.image, input.testCommand);
		if (baselineResult.infrastructureFailure)
			throw new Error(`Baseline test infrastructure failed: ${baselineResult.stderr}`);
		await assertTestRepositoryState(baseline, sourceCommit, []);
		if (baselineResult.exitCode !== 0) throw new Error("Local benchmark source baseline must pass before mutation.");
		await command("git", ["clone", "--quiet", "--bare", "--no-hardlinks", repoPath, stagedMirror]);

		const tasks: Record<string, unknown>[] = [];
		for (let index = 0; index < candidates.length; index += 1) {
			const candidate = candidates[index];
			const workspace = join(root, `candidate-${index + 1}`);
			await command("git", ["clone", "--quiet", "--no-hardlinks", repoPath, workspace]);
			const filePath = join(workspace, candidate.file);
			const source = await readFile(filePath, "utf8");
			const mutatedSource = replaceLine(source, candidate.line, candidate.mutated);
			await writeFile(filePath, mutatedSource);
			const result = await runTest(workspace, input.image, input.testCommand);
			if (result.infrastructureFailure) throw new Error(`Mutant test infrastructure failed: ${result.stderr}`);
			if ((await readFile(filePath, "utf8")) !== mutatedSource) {
				throw new Error(`Declared test command modified mutated implementation file ${candidate.file}.`);
			}
			await assertTestRepositoryState(workspace, sourceCommit, [candidate.file]);
			if (result.exitCode === 0) continue;
			const goldPatch = await command("git", ["diff", "--binary", "-R", "--", candidate.file], workspace);
			if (!goldPatch) throw new Error(`Killed mutant ${candidate.file}:${candidate.line} produced no gold patch.`);
			await command("git", ["add", "--", candidate.file], workspace);
			const commitEnv = {
				GIT_AUTHOR_DATE: sourceDate,
				GIT_COMMITTER_DATE: sourceDate,
			};
			await command(
				"git",
				[
					"-c",
					"commit.gpgsign=false",
					"-c",
					"user.name=!Klein Local Mint",
					"-c",
					"user.email=local-mint@localhost",
					"commit",
					"--quiet",
					"-m",
					`local benchmark mutant ${index + 1}`,
				],
				workspace,
				commitEnv,
			);
			const bugCommit = await command("git", ["rev-parse", "HEAD"], workspace);
			const instanceId = `local-${input.repoName.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}-${bugCommit.slice(0, 12)}`;
			await command("git", ["push", "--quiet", stagedMirror, `HEAD:refs/heads/${instanceId}`], workspace);
			tasks.push({
				instance_id: instanceId,
				repo: input.repoName,
				base_commit: bugCommit,
				problem_statement: localBenchmarkProblemStatement(candidate.file),
				patch: `${goldPatch}\n`,
				test_patch: "",
				hints_text: "",
				FAIL_TO_PASS: ["local-oracle::test-command"],
				PASS_TO_PASS: ["local-oracle::baseline"],
				difficulty: "unknown",
				created_at: sourceDate,
				local_oracle: {
					image: input.image,
					test_command: input.testCommand,
					test_files: input.testFiles,
					solution_files: input.implementationFiles,
				},
				_nklein_provenance: { source_commit: sourceCommit, swe_smith_reference_commit: PINNED_SWE_SMITH_COMMIT },
			});
		}
		if (tasks.length === 0) throw new Error("No mutation was killed by the declared test command.");
		await rename(stagedMirror, mirrorPath).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "EEXIST" || error.code === "ENOTEMPTY") {
				throw new Error(`Refusing to replace existing local benchmark mirror: ${mirrorPath}`);
			}
			throw error;
		});
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(tasks, null, 2)}\n`, { flag: "wx" }).catch(async (error) => {
			await rename(mirrorPath, stagedMirror).catch(() => undefined);
			throw error;
		});
		return { outputPath, mirrorPath, sourceCommit, validMutants: tasks.length };
	} finally {
		await rm(root, { recursive: true, force: true });
		if (publishRoot) await rm(publishRoot, { recursive: true, force: true });
	}
}
