/**
 * N8 — SWE-bench instance MATERIALIZER: turn one pinned cache entry into a workspace the drain can hand to
 * !Klein. Hermetic by refusal: every byte comes from `.nklein-bench/swebench/` (populated only by the explicit
 * `scripts/swebench-fetch.mts` egress step), the tarball is sha256-verified against its pin BEFORE extraction,
 * and a missing/drifted cache fails with the exact fetch command — never a silent download.
 *
 * The workspace is the repo at `base_commit` EXACTLY (single git commit, default branch `main`): the agent
 * never sees the instance's `test_patch` (grader-side only) and never sees gold (which the cache cannot even
 * contain — the fetcher drops it at index time).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { type SwebenchInstanceMetadata, type SwebenchPin, verifySwebenchPin } from "./swebench-instance";

const execFileAsync = promisify(execFile);

export interface MaterializedSwebenchInstance {
	readonly instance: SwebenchInstanceMetadata;
	readonly workspacePath: string;
	readonly baseCommitSha: string;
	readonly tarballSha256: string;
}

export function swebenchCacheRoot(repoRoot: string): string {
	return join(repoRoot, ".nklein-bench", "swebench");
}

function fetchRemedy(instanceId: string): string {
	return `run \`tsx scripts/swebench-fetch.mts index\` then \`tsx scripts/swebench-fetch.mts materialize ${instanceId}\` (explicit egress step)`;
}

/** Read one instance's metadata + pin from the cache, refusing with the fetch remedy when absent. */
export async function readSwebenchCacheEntry(
	cacheRoot: string,
	instanceId: string,
): Promise<{ instance: SwebenchInstanceMetadata; pin: SwebenchPin; tarballPath: string }> {
	const instancePath = join(cacheRoot, "instances", `${instanceId}.json`);
	const pinsPath = join(cacheRoot, "pins.json");
	const tarballPath = join(cacheRoot, "repos", `${instanceId}.tar.gz`);
	for (const [path, what] of [
		[instancePath, "instance metadata"],
		[pinsPath, "pins"],
		[tarballPath, "repo tarball"],
	] as const) {
		if (!existsSync(path)) {
			throw new Error(`SWE-bench cache is missing ${what} for ${instanceId} (${path}) — ${fetchRemedy(instanceId)}`);
		}
	}
	const instance = JSON.parse(await readFile(instancePath, "utf8")) as SwebenchInstanceMetadata;
	const pins = JSON.parse(await readFile(pinsPath, "utf8")) as Record<string, SwebenchPin>;
	const pin = pins[instanceId];
	if (!pin) {
		throw new Error(`pins.json has no entry for ${instanceId} — ${fetchRemedy(instanceId)}`);
	}
	return { instance, pin, tarballPath };
}

/**
 * Materialize the instance into `targetDir` (created; must not already exist — a half-materialized workspace
 * must never be silently reused). Verifies the pin, extracts the single top-level tarball directory, and
 * creates the one-commit git history the card's `baseRef` builds on.
 */
export async function materializeSwebenchInstance(input: {
	cacheRoot: string;
	instanceId: string;
	targetDir: string;
}): Promise<MaterializedSwebenchInstance> {
	if (existsSync(input.targetDir)) {
		throw new Error(`materialize target ${input.targetDir} already exists — refuse to reuse a stale workspace.`);
	}
	const { instance, pin, tarballPath } = await readSwebenchCacheEntry(input.cacheRoot, input.instanceId);
	const tarball = await readFile(tarballPath);
	const verification = verifySwebenchPin(tarball, pin);
	if (!verification.ok) {
		throw new Error(`SWE-bench cache pin verification failed for ${input.instanceId}: ${verification.reason}`);
	}
	const stagingDir = `${input.targetDir}.extract-tmp`;
	await rm(stagingDir, { recursive: true, force: true });
	await mkdir(stagingDir, { recursive: true });
	try {
		await execFileAsync("tar", ["-xzf", tarballPath, "-C", stagingDir]);
		const entries = await readdir(stagingDir);
		if (entries.length !== 1 || entries[0] === undefined) {
			throw new Error(
				`expected exactly one top-level directory in ${input.instanceId}'s tarball, found ${entries.length}`,
			);
		}
		await rename(join(stagingDir, entries[0]), input.targetDir);
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
	const git = (...args: string[]) => execFileAsync("git", ["-C", input.targetDir, ...args]);
	await git("init", "--quiet", "--initial-branch=main");
	await git("add", "-A");
	await git(
		"-c",
		"user.email=swebench@local",
		"-c",
		"user.name=swebench",
		"commit",
		"--quiet",
		"-m",
		`${instance.repo} @ ${instance.baseCommit} (SWE-bench ${input.instanceId})`,
	);
	const { stdout } = await git("rev-parse", "HEAD");
	return {
		instance,
		workspacePath: input.targetDir,
		baseCommitSha: stdout.trim(),
		tarballSha256: verification.sha256,
	};
}
