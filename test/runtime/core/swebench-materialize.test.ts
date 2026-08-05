import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { materializeSwebenchInstance, readSwebenchCacheEntry } from "../../../src/core/swebench-materialize";

const execFileAsync = promisify(execFile);

/**
 * N8 — materializer contract: cache-only (missing cache names the fetch remedy), pin-verified BEFORE
 * extraction, one-commit git workspace, and no stale-workspace reuse. The cache here is synthetic: a tiny
 * repo tarball built by the test, pinned exactly like the fetcher would.
 */
let cacheRoot: string;
let workRoot: string;
const INSTANCE_ID = "acme__tiny-1";

beforeAll(async () => {
	workRoot = await mkdtemp(join(tmpdir(), "swebench-mat-"));
	cacheRoot = join(workRoot, "cache");
	const repoDir = join(workRoot, "tiny-abc123");
	await mkdir(join(repoDir, "src"), { recursive: true });
	await writeFile(join(repoDir, "src", "lib.py"), "def add(a, b):\n    return a - b  # bug\n");
	await writeFile(join(repoDir, "README.md"), "tiny\n");
	const tarballPath = join(workRoot, `${INSTANCE_ID}.tar.gz`);
	await execFileAsync("tar", ["-czf", tarballPath, "-C", workRoot, "tiny-abc123"]);
	const tarball = await readFile(tarballPath);
	await mkdir(join(cacheRoot, "instances"), { recursive: true });
	await mkdir(join(cacheRoot, "repos"), { recursive: true });
	await writeFile(join(cacheRoot, "repos", `${INSTANCE_ID}.tar.gz`), tarball);
	await writeFile(
		join(cacheRoot, "instances", `${INSTANCE_ID}.json`),
		JSON.stringify({
			instanceId: INSTANCE_ID,
			repo: "acme/tiny",
			baseCommit: "abc123abc123abc123abc123abc123abc123abc1",
			datasets: ["synthetic"],
			failToPass: ["tests/test_lib.py::test_add"],
			passToPass: [],
			testPatch: "diff --git a/tests/test_lib.py b/tests/test_lib.py\n+...",
			problemStatement: "add() subtracts",
			goldPatchBytes: 10,
			goldPatchFiles: 1,
			version: null,
		}),
	);
	await writeFile(
		join(cacheRoot, "pins.json"),
		JSON.stringify({
			[INSTANCE_ID]: {
				repo: "acme/tiny",
				baseCommit: "abc123abc123abc123abc123abc123abc123abc1",
				tarballSha256: createHash("sha256").update(tarball).digest("hex"),
				bytes: tarball.byteLength,
			},
		}),
	);
});

describe("readSwebenchCacheEntry", () => {
	it("refuses a missing instance with the exact fetch remedy (hermetic posture)", async () => {
		await expect(readSwebenchCacheEntry(cacheRoot, "acme__absent-9")).rejects.toThrow(/swebench-fetch\.mts/);
	});
});

describe("materializeSwebenchInstance", () => {
	it("verifies the pin, extracts, and produces the one-commit git workspace", async () => {
		const targetDir = join(workRoot, "ws-ok");
		const materialized = await materializeSwebenchInstance({ cacheRoot, instanceId: INSTANCE_ID, targetDir });
		expect(materialized.instance.instanceId).toBe(INSTANCE_ID);
		expect(await readFile(join(targetDir, "src", "lib.py"), "utf8")).toContain("def add");
		const { stdout: log } = await execFileAsync("git", ["-C", targetDir, "log", "--oneline"]);
		expect(log.trim().split("\n")).toHaveLength(1);
		expect(log).toContain("SWE-bench acme__tiny-1");
		expect(materialized.baseCommitSha).toMatch(/^[0-9a-f]{40}$/);
	});

	it("refuses to reuse an existing target directory", async () => {
		const targetDir = join(workRoot, "ws-taken");
		await mkdir(targetDir, { recursive: true });
		await expect(materializeSwebenchInstance({ cacheRoot, instanceId: INSTANCE_ID, targetDir })).rejects.toThrow(
			/already exists/,
		);
	});

	it("a drifted tarball fails BEFORE extraction, naming the refetch remedy", async () => {
		await writeFile(join(cacheRoot, "repos", `${INSTANCE_ID}.tar.gz`), Buffer.from("tampered-bytes"));
		const targetDir = join(workRoot, "ws-drift");
		await expect(materializeSwebenchInstance({ cacheRoot, instanceId: INSTANCE_ID, targetDir })).rejects.toThrow(
			/pin verification failed/,
		);
	});
});
