import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSwebenchInstance } from "../../../src/core/swebench-benchmark";
import { materializeSwebenchWorkspace } from "../../../src/nklein-agent/nklein-swebench-workspace";

const instance = parseSwebenchInstance({
	instance_id: "owner__repo-1",
	repo: "owner/repo",
	base_commit: "0123456789abcdef",
	problem_statement: "Fix it.",
	patch: "gold",
	test_patch: "private tests",
	hints_text: "secret",
	FAIL_TO_PASS: ["new"],
	PASS_TO_PASS: ["old"],
});

describe("materializeSwebenchWorkspace", () => {
	it("requires a pre-fetched local mirror and never invents an egress fetch", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-swe-missing-"));
		const work = join(root, "work");
		await expect(
			materializeSwebenchWorkspace({
				instance,
				repoCacheDir: join(root, "cache"),
				workspaceParentDir: work,
				image: "nklein/agent-sandbox:0.0.1",
				runDocker: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			}),
		).rejects.toThrow(/explicit egress-gated operator step/);
		expect((await readdir(work)).some((entry) => entry.startsWith(".nklein-benchmark-input-"))).toBe(false);
	});

	it("refuses and preserves any pre-existing exact workspace path, including a regular file", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-swe-existing-"));
		const cache = join(root, "cache");
		const work = join(root, "work");
		await mkdir(cache);
		await mkdir(work);
		await writeFile(join(cache, "owner__repo.git"), "placeholder");
		const occupied = join(work, instance.instanceId);
		await writeFile(occupied, "user-owned");
		await expect(
			materializeSwebenchWorkspace({
				instance,
				repoCacheDir: cache,
				workspaceParentDir: work,
				image: "nklein/agent-sandbox:0.0.1",
				runDocker: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
			}),
		).rejects.toThrow(/already exists/);
		expect(await readFile(occupied, "utf8")).toBe("user-owned");
	});

	it("cleans oracle input after a successful materialization", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-swe-ok-"));
		const cache = join(root, "cache");
		const work = join(root, "work");
		await mkdir(cache);
		await writeFile(join(cache, "owner__repo.git"), "placeholder");
		const calls: readonly string[][] = [];
		const mutableCalls = calls as string[][];
		const result = await materializeSwebenchWorkspace({
			instance,
			repoCacheDir: cache,
			workspaceParentDir: work,
			image: "nklein/agent-sandbox:0.0.1",
			uid: 501,
			gid: 20,
			runDocker: async (args) => {
				mutableCalls.push([...args]);
				if (args.includes("clone")) await mkdir(join(work, instance.instanceId));
				return { exitCode: 0, stdout: "", stderr: "" };
			},
		});
		expect(result.dockerStepCount).toBe(calls.length);
		expect(calls.every((call) => call.includes("none"))).toBe(true);
		expect((await readdir(work)).some((entry) => entry.startsWith(".nklein-benchmark-input-"))).toBe(false);
	});

	it("removes a half-built workspace when a Docker step fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-swe-fail-"));
		const cache = join(root, "cache");
		const work = join(root, "work");
		await mkdir(cache);
		await writeFile(join(cache, "owner__repo.git"), "placeholder");
		let count = 0;
		await expect(
			materializeSwebenchWorkspace({
				instance,
				repoCacheDir: cache,
				workspaceParentDir: work,
				image: "nklein/agent-sandbox:0.0.1",
				uid: 501,
				gid: 20,
				runDocker: async (args) => {
					count += 1;
					if (args.includes("clone")) await mkdir(join(work, instance.instanceId));
					return count === 2
						? { exitCode: 1, stdout: "", stderr: "checkout failed" }
						: { exitCode: 0, stdout: "", stderr: "" };
				},
			}),
		).rejects.toThrow(/checkout failed/);
		await expect(readFile(join(work, instance.instanceId, "anything"))).rejects.toThrow();
	});
});
