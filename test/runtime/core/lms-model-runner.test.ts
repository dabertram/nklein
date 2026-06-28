import { describe, expect, it } from "vitest";
import { type LmsRunner, loadModelExclusive } from "../../../src/core/lms-model-runner";

const GiB = 1024 ** 3;
const totalRamBytes = 128 * GiB;

const PS_HEADER = "IDENTIFIER          MODEL          STATUS    SIZE       CONTEXT    PARALLEL    DEVICE    TTL";

/** A fake `lms` runner: serves a scripted `ps` table and records every invocation. */
function fakeRunner(psRows: string[], loadExit = 0) {
	const calls: string[][] = [];
	const run: LmsRunner = async (args) => {
		calls.push([...args]);
		if (args[0] === "ps") {
			return { stdout: [PS_HEADER, ...psRows].join("\n"), exitCode: 0 };
		}
		if (args[0] === "load") {
			return { stdout: loadExit === 0 ? "loaded" : "error: oom", exitCode: loadExit };
		}
		return { stdout: "", exitCode: 0 };
	};
	return { run, calls };
}

describe("loadModelExclusive", () => {
	it("unloads every non-pinned, non-embedding model, then loads the target with context 40000", async () => {
		const { run, calls } = fakeRunner([
			"qwen/qwen3-8b-m5max          qwen3-8b          IDLE      4.62 GB    40000      1    Local",
			"text-embedding-nomic@q8      nomic             IDLE      146.15 MB  2048       -    m4mini",
		]);
		const result = await loadModelExclusive(run, { modelId: "qwen/qwen2.5-coder-14b-m5max", totalRamBytes });
		expect(result.loaded).toBe(true);
		expect(result.unloaded).toEqual(["qwen/qwen3-8b-m5max"]); // embedding kept
		// It unloaded qwen3-8b then loaded the target with --context-length 40000.
		expect(calls).toContainEqual(["unload", "qwen/qwen3-8b-m5max"]);
		const load = calls.find((c) => c[0] === "load");
		expect(load).toBeTruthy();
		expect(load).toContain("qwen/qwen2.5-coder-14b-m5max");
		expect(load).toContain("40000");
	});

	it("never unloads pinned identifiers", async () => {
		const { run, calls } = fakeRunner([
			"keep-me          m          IDLE      4 GB       40000      1    Local",
			"drop-me          m          IDLE      4 GB       40000      1    Local",
		]);
		const result = await loadModelExclusive(run, {
			modelId: "target",
			totalRamBytes,
			pinnedIdentifiers: ["keep-me"],
		});
		expect(result.unloaded).toEqual(["drop-me"]);
		expect(calls).not.toContainEqual(["unload", "keep-me"]);
	});

	it("refuses (no load) when the headroom guard fails, after still clearing the others", async () => {
		const { run, calls } = fakeRunner([
			"big-pinned          m          IDLE      120 GB     40000      1    Local",
			"drop-me             m          IDLE      4 GB       40000      1    Local",
		]);
		const result = await loadModelExclusive(run, {
			modelId: "target",
			totalRamBytes,
			pinnedIdentifiers: ["big-pinned"], // 120 GB kept + 16 GB candidate → over the reserve
			candidateSizeBytes: 16 * GiB,
		});
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/reserve|freeze/i);
		expect(result.unloaded).toEqual(["drop-me"]); // still cleared the unpinned one
		expect(calls.find((c) => c[0] === "load")).toBeUndefined(); // never attempted the load
	});

	it("is idempotent when the target is already resident (clears others, reports resident)", async () => {
		const { run, calls } = fakeRunner([
			"target          m          IDLE      4 GB       40000      1    Local",
			"other           m          IDLE      4 GB       40000      1    Local",
		]);
		const result = await loadModelExclusive(run, { modelId: "target", totalRamBytes });
		expect(result.loaded).toBe(true);
		expect(result.reason).toMatch(/already resident/i);
		expect(result.unloaded).toEqual(["other"]);
		expect(calls.find((c) => c[0] === "load")).toBeUndefined();
	});

	it("reports a failed lms load", async () => {
		const { run } = fakeRunner([], 1);
		const result = await loadModelExclusive(run, { modelId: "target", totalRamBytes });
		expect(result.loaded).toBe(false);
		expect(result.reason).toMatch(/lms load failed/i);
	});
});
