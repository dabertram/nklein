import { describe, expect, it, vi } from "vitest";
import type { AgentSandboxExecResult } from "../../../src/nklein-agent/nklein-agent-sandbox";
import {
	buildExposeTaskCacheScript,
	buildFinalizeImportedSeedScript,
	buildHarvestIntoSeedScript,
	buildSeedIntoTaskCacheScript,
	classifySeedScriptResult,
	harvestSandboxPackageCache,
	NPM_CACHE_SEED_MAX_KB,
	SANDBOX_NPM_CACHE_SEED_ENV,
	seedSandboxPackageCache,
} from "../../../src/nklein-agent/nklein-sandbox-package-cache-seed";
import { primeSandboxToolchain } from "../../../src/nklein-agent/nklein-sandbox-toolchain-prime";

const paths = {
	seedDir: "/workspaces/.nklein-cache/.seed/npm",
	taskCacheDir: "/workspaces/.nklein-cache/70001-t1",
	taskNpmCacheDir: "/workspaces/.nklein-cache/70001-t1/npm",
};

describe("P1.NPMSEED scripts (the trust boundary is in the shell that root runs)", () => {
	it("seeds only into an absent task cache from a present, size-capped seed — copies, never links", () => {
		const script = buildSeedIntoTaskCacheScript(paths);
		expect(script).toContain('[ -d "$seed/_cacache" ] || { echo "skipped: no seed"; exit 0; }');
		expect(script).toContain('[ -e "$task/_cacache" ] && { echo "skipped: task cache present"; exit 0; }');
		expect(script).toContain(`-gt ${NPM_CACHE_SEED_MAX_KB}`);
		expect(script).toContain('cp -Rp "$seed/." "$task/"');
		expect(script).not.toContain("cp -al");
	});

	it("harvests content blobs and ONLY tarball-keyed index entries into the root-owned seed, no-clobber", () => {
		const expose = buildExposeTaskCacheScript(paths);
		expect(expose).toContain('chmod a+rx "$root" "$task" && chmod -R a+rX "$task/_cacache"');
		const harvest = buildHarvestIntoSeedScript(paths);
		expect(harvest).toContain('cp -Rpn "$src/content-v2/." "$seed/_cacache/content-v2/"');
		expect(harvest).toContain(`grep -q '\\.tgz"' "$f" || continue`);
		expect(harvest).toContain('[ -e "$dest" ] && continue');
		expect(harvest).toContain('chmod -R a+rX "$seed"');
		expect(harvest).toContain("skipped: seed full");
		// Packuments never cross the task boundary: nothing copies index-v5 wholesale.
		expect(harvest).not.toMatch(/cp -R[a-z]* "\$src\/index-v5/u);
		expect(buildFinalizeImportedSeedScript({ seedDir: paths.seedDir })).toContain('touch "$seed/.imported"');
	});

	it("classifies script results: skipped lines, exit codes, success", () => {
		const ok = { exitCode: 0, stdout: "seeded 40k\n", stderr: "" };
		expect(classifySeedScriptResult("seed", ok)).toEqual({ status: "seeded", detail: "seeded 40k" });
		expect(classifySeedScriptResult("harvest", { exitCode: 0, stdout: "harvested 41k", stderr: "" })).toEqual({
			status: "harvested",
			detail: "harvested 41k",
		});
		expect(classifySeedScriptResult("seed", { exitCode: 0, stdout: "skipped: no seed", stderr: "" }).status).toBe(
			"skipped",
		);
		expect(classifySeedScriptResult("seed", { exitCode: 1, stdout: "", stderr: "cp: boom" })).toEqual({
			status: "error",
			detail: "cp: boom",
		});
	});
});

describe("seed/harvest orchestration", () => {
	it("is a no-op when disabled or when the manager has no seed seam; otherwise records non-skip outcomes", async () => {
		const record = vi.fn();
		expect(await seedSandboxPackageCache({ manager: {}, taskId: "t", recordObservation: record })).toBeNull();
		const manager = {
			seedTaskPackageCache: vi.fn(async () => ({ status: "seeded" as const, detail: "seeded 40k" })),
			harvestTaskPackageCache: vi.fn(async () => ({ status: "skipped" as const, detail: "skipped: no task cache" })),
		};
		expect(
			await seedSandboxPackageCache({
				manager,
				taskId: "t",
				env: { [SANDBOX_NPM_CACHE_SEED_ENV]: "0" },
				recordObservation: record,
			}),
		).toBeNull();
		expect(manager.seedTaskPackageCache).not.toHaveBeenCalled();
		expect(await seedSandboxPackageCache({ manager, taskId: "t", env: {}, recordObservation: record })).toEqual({
			status: "seeded",
			detail: "seeded 40k",
		});
		expect(record).toHaveBeenCalledTimes(1);
		expect(record.mock.calls[0]?.[0]?.metadata).toMatchObject({ category: "sandbox_npm_cache_seed", phase: "seed" });
		// Skips are silent; a throwing seam becomes an error outcome, never a thrown start.
		expect(
			await harvestSandboxPackageCache({ manager, taskId: "t", env: {}, recordObservation: record }),
		).toMatchObject({
			status: "skipped",
		});
		expect(record).toHaveBeenCalledTimes(1);
		const throwing = { harvestTaskPackageCache: vi.fn(async () => Promise.reject(new Error("docker gone"))) };
		expect(
			await harvestSandboxPackageCache({ manager: throwing, taskId: "t", env: {}, recordObservation: record }),
		).toEqual({
			status: "error",
			detail: "docker gone",
		});
	});

	it("the worker prime seeds before the first install and harvests after a ready install only", async () => {
		const calls: string[] = [];
		const manager = {
			listSandboxRootFileNames: async () => ["package.json", "package-lock.json"],
			exec: async (_taskId: string, argv: readonly string[]): Promise<AgentSandboxExecResult> => {
				calls.push(argv.join(" ").includes("npm") ? "install" : "probe");
				return { exitCode: 0, stdout: "added 48 packages", stderr: "" };
			},
			seedTaskPackageCache: vi.fn(async () => {
				calls.push("seed");
				return { status: "seeded" as const, detail: "seeded 40k" };
			}),
			harvestTaskPackageCache: vi.fn(async () => {
				calls.push("harvest");
				return { status: "harvested" as const, detail: "harvested 40k" };
			}),
		};
		const report = await primeSandboxToolchain({ manager, taskId: "t1", recordObservation: vi.fn(), env: {} });
		expect(report?.status).toBe("ready");
		expect(calls[0]).toBe("seed");
		expect(calls.indexOf("install")).toBeGreaterThan(calls.indexOf("seed"));
		expect(calls.at(-1)).toBe("harvest");
		// A failed install never harvests (nothing trustworthy to merge).
		const failing = {
			...manager,
			exec: async (_taskId: string, argv: readonly string[]): Promise<AgentSandboxExecResult> =>
				argv.join(" ").includes("npm")
					? { exitCode: 1, stdout: "", stderr: "npm error ETIMEDOUT" }
					: { exitCode: 0, stdout: "/usr/bin/node", stderr: "" },
			harvestTaskPackageCache: vi.fn(async () => ({ status: "harvested" as const, detail: "x" })),
		};
		const failed = await primeSandboxToolchain({
			manager: failing,
			taskId: "t2",
			recordObservation: vi.fn(),
			env: {},
		});
		expect(failed?.status).toBe("failed");
		expect(failing.harvestTaskPackageCache).not.toHaveBeenCalled();
	});
});
