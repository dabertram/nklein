import { describe, expect, it } from "vitest";
import { type LmsRunner, loadModelExclusive } from "../../../src/core/lms-model-runner";

const GiB = 1024 ** 3;
const totalRamBytes = 128 * GiB;

const PS_HEADER = "IDENTIFIER          MODEL          STATUS    SIZE       CONTEXT    PARALLEL    DEVICE    TTL";
const LINK_STATUS = JSON.stringify({
	deviceName: "m5max",
	preferredDeviceIdentifier: "old-device",
	peers: [{ deviceIdentifier: "remote-device", deviceName: "m4mini", status: "connected" }],
});

/** A fake `lms` runner: serves a scripted `ps` table and records every invocation. */
function fakeRunner(
	psRows: string[],
	loadExit = 0,
	options: { setPreferredExit?: number; throwOnRestorePreferred?: boolean } = {},
) {
	const calls: string[][] = [];
	const run: LmsRunner = async (args) => {
		calls.push([...args]);
		if (args[0] === "ps") {
			return { stdout: [PS_HEADER, ...psRows].join("\n"), exitCode: 0 };
		}
		if (args[0] === "link" && args[1] === "status") {
			return { stdout: LINK_STATUS, exitCode: 0 };
		}
		if (args[0] === "link" && args[1] === "set-preferred-device") {
			if (options.throwOnRestorePreferred && args[2] === "old-device") {
				throw new Error("restore failed");
			}
			return {
				stdout: options.setPreferredExit === 0 || options.setPreferredExit === undefined ? "ok" : "no link",
				exitCode: options.setPreferredExit ?? 0,
			};
		}
		if (args[0] === "load") {
			return { stdout: loadExit === 0 ? "loaded" : "error: oom", exitCode: loadExit };
		}
		return { stdout: "", exitCode: 0 };
	};
	return { run, calls };
}

describe("loadModelExclusive", () => {
	it("§5.AL gate: REFUSES a catalog-rejected model without unloading the resident or spawning a load", async () => {
		const { run, calls } = fakeRunner([
			"qwen/qwen3-8b-m5max          qwen3-8b          IDLE      4.62 GB    40000      1    Local",
		]);
		// phi-4-mini-reasoning is TOOL_UNSUITABLE → reject under the default policy.
		const result = await loadModelExclusive(run, { modelId: "microsoft/phi-4-mini-reasoning", totalRamBytes });
		expect(result.loaded).toBe(false);
		expect(result.unloaded).toEqual([]); // the good resident model was NOT unloaded
		expect(result.suitability.severity).toBe("reject");
		expect(result.reason).toMatch(/capability gate/i);
		// No unload, no load — the gate is first, before any side effect.
		expect(calls.some((c) => c[0] === "unload" || c[0] === "load")).toBe(false);
	});

	it("§5.AL gate: a relaxed policy lets a rejected model through (warn), and the caveat rides the reason", async () => {
		const { run } = fakeRunner([]);
		const result = await loadModelExclusive(run, {
			modelId: "microsoft/phi-4-mini-reasoning",
			totalRamBytes,
			suitabilityPolicy: { onUnsuitable: "warn", onUnknown: "warn" },
		});
		expect(result.loaded).toBe(true);
		expect(result.suitability.severity).toBe("warn");
		expect(result.reason).toMatch(/capability warn/i);
	});

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

	it("§5.AQ-G: opt-in right-sizing FLOORS a small task to ≥32k (not the 40k default, not the model max)", async () => {
		const { run, calls } = fakeRunner([]);
		const result = await loadModelExclusive(run, {
			modelId: "qwen/qwen2.5-coder-14b-m5max",
			totalRamBytes,
			taskNeededTokens: 6000,
			maxContextLength: 262_144,
		});
		expect(result.loaded).toBe(true);
		const load = calls.find((c) => c[0] === "load");
		// 6k task fits well under the floor → 32000 (NOT the 40000 default, NOT the 262144 max).
		expect(load).toContain("32000");
		expect(load).not.toContain("262144");
	});

	it("§5.AQ-G: opt-in right-sizing SIZES UP a big-context task but never to the model max", async () => {
		const { run, calls } = fakeRunner([]);
		await loadModelExclusive(run, {
			modelId: "qwen/qwen2.5-coder-14b-m5max",
			totalRamBytes,
			taskNeededTokens: 80_000,
			maxContextLength: 262_144,
		});
		const load = calls.find((c) => c[0] === "load");
		// 80k * 1.25 headroom = 100000 → next 1024 multiple (100352), above the floor, well below the 262k max.
		expect(load).toContain("100352");
		expect(load).not.toContain("262144");
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

	it("per-machine scoping: with targetDevice set, only clears residents on the SAME device (never a linked box)", async () => {
		const { run, calls } = fakeRunner([
			"m5-model          m          IDLE      4 GB       40000      1    Local",
			"legion-model      m          IDLE      4 GB       40000      1    davidlegion5pro",
			"text-embedding-nomic@q8      nomic             IDLE      146.15 MB  2048       -    m4mini",
		]);
		const result = await loadModelExclusive(run, {
			modelId: "legion-target",
			totalRamBytes,
			targetDevice: "davidlegion5pro",
		});
		expect(result.loaded).toBe(true);
		// only the same-device (legion) model was cleared; the m5 model + m4mini embedder are untouched
		expect(result.unloaded).toEqual(["legion-model"]);
		expect(calls).toContainEqual(["unload", "legion-model"]);
		expect(calls).not.toContainEqual(["unload", "m5-model"]);
	});

	it("sets and restores the preferred LM Link device around a remote load", async () => {
		const { run, calls } = fakeRunner([
			"local-model       m          IDLE      4 GB       40000      1    Local",
			"remote-model      m          IDLE      4 GB       40000      1    m4mini",
		]);
		const result = await loadModelExclusive(run, {
			modelId: "remote-target",
			totalRamBytes: 24 * GiB,
			targetDevice: "m4mini",
			targetDeviceIdentifier: "remote-device",
			candidateSizeBytes: 4 * GiB,
		});
		expect(result.loaded).toBe(true);
		expect(result.unloaded).toEqual(["remote-model"]);
		expect(calls).toContainEqual(["link", "status", "--json"]);
		expect(calls).toContainEqual(["link", "set-preferred-device", "remote-device"]);
		expect(calls).toContainEqual(["link", "set-preferred-device", "old-device"]);
		expect(calls).not.toContainEqual(["unload", "local-model"]);
	});

	it("keeps the load result when restoring the previous preferred LM Link device fails", async () => {
		const { run, calls } = fakeRunner(
			["remote-model      m          IDLE      4 GB       40000      1    m4mini"],
			0,
			{ throwOnRestorePreferred: true },
		);
		const result = await loadModelExclusive(run, {
			modelId: "remote-target",
			totalRamBytes: 24 * GiB,
			targetDevice: "m4mini",
			targetDeviceIdentifier: "remote-device",
			candidateSizeBytes: 4 * GiB,
		});
		expect(result.loaded).toBe(true);
		expect(result.reason).toMatch(/^Loaded/);
		expect(calls).toContainEqual(["link", "set-preferred-device", "old-device"]);
	});

	it("does not switch the preferred device when the target is already resident", async () => {
		const { run, calls } = fakeRunner(["remote-target      m          IDLE      4 GB       40000      1    m4mini"]);
		const result = await loadModelExclusive(run, {
			modelId: "remote-target",
			totalRamBytes: 24 * GiB,
			targetDevice: "m4mini",
			targetDeviceIdentifier: "remote-device",
		});
		expect(result.loaded).toBe(true);
		expect(calls.some((call) => call[0] === "link")).toBe(false);
		expect(calls.some((call) => call[0] === "load")).toBe(false);
	});

	it("fails closed before unload/load when LM Link cannot select the target device", async () => {
		const { run, calls } = fakeRunner(
			["remote-model      m          IDLE      4 GB       40000      1    m4mini"],
			0,
			{ setPreferredExit: 1 },
		);
		const result = await loadModelExclusive(run, {
			modelId: "remote-target",
			totalRamBytes: 24 * GiB,
			targetDevice: "m4mini",
			targetDeviceIdentifier: "remote-device",
		});
		expect(result.loaded).toBe(false);
		expect(result.reason).toContain("Failed to set LM Link preferred device");
		expect(calls).not.toContainEqual(["unload", "remote-model"]);
		expect(calls.some((call) => call[0] === "load")).toBe(false);
	});

	it("passes a numeric gpu offload ratio through to the load argv (small-VRAM linked box)", async () => {
		const { run, calls } = fakeRunner([]);
		await loadModelExclusive(run, { modelId: "legion-target", totalRamBytes, gpu: 0.3 });
		const load = calls.find((c) => c[0] === "load");
		expect(load).toContain("--gpu");
		expect(load).toContain("0.3");
	});

	it("defaults gpu to max (full offload) when unspecified — unchanged for existing callers", async () => {
		const { run, calls } = fakeRunner([]);
		await loadModelExclusive(run, { modelId: "legion-target", totalRamBytes });
		const load = calls.find((c) => c[0] === "load");
		expect(load).toContain("--gpu");
		expect(load).toContain("max");
	});
});

// ─── §5.AN REST-transport twin ───────────────────────────────────────────────

import { loadModelExclusiveViaRest } from "../../../src/core/lms-model-runner";
import type { LmStudioRestModel, LmStudioRestModelClient } from "../../../src/core/lmstudio-rest-model-client";

function restModel(key: string, overrides: Partial<LmStudioRestModel> = {}): LmStudioRestModel {
	return {
		type: "llm",
		key,
		displayName: key,
		architecture: null,
		sizeBytes: 8 * GiB,
		paramsString: null,
		loadedInstanceIds: [],
		maxContextLength: 262_144,
		...overrides,
	};
}

/** A fake REST client over a mutable model list; records load/unload calls. */
function fakeRestClient(models: LmStudioRestModel[]) {
	const calls: { kind: "load" | "unload"; payload: Record<string, unknown> }[] = [];
	const client: LmStudioRestModelClient = {
		async listModels() {
			return { ok: true, value: models };
		},
		async loadModel(input) {
			calls.push({ kind: "load", payload: { ...input } });
			return { ok: true, value: { instanceId: input.model, loadTimeSeconds: 3.1, status: "loaded" } };
		},
		async unloadModel(input) {
			calls.push({ kind: "unload", payload: { ...input } });
			return { ok: true, value: { instanceId: input.instanceId } };
		},
		async downloadModel(input) {
			return { ok: true, value: { model: input.model } };
		},
	};
	return { client, calls };
}

describe("loadModelExclusiveViaRest (§5.AN — same guardrails, REST transport)", () => {
	it("unloads every non-pinned, non-embedding loaded model, then loads with the requested context", async () => {
		const { client, calls } = fakeRestClient([
			restModel("target"),
			restModel("other", { loadedInstanceIds: ["other-1"] }),
			restModel("keep-pinned", { loadedInstanceIds: ["pin-1"] }),
			restModel("text-embedding-nomic", { loadedInstanceIds: ["embed-1"] }),
		]);
		const result = await loadModelExclusiveViaRest(client, {
			modelId: "target",
			totalRamBytes,
			contextLength: 40_000,
			pinnedIdentifiers: ["keep-pinned"],
		});
		expect(result.loaded).toBe(true);
		expect(result.unloaded).toEqual(["other"]);
		expect(calls).toEqual([
			{ kind: "unload", payload: { instanceId: "other-1" } },
			{ kind: "load", payload: { model: "target", contextLength: 40_000 } },
		]);
	});

	it("§5.AL gate: REFUSES a catalog-rejected model without unloading or loading", async () => {
		const { client, calls } = fakeRestClient([
			restModel("target"),
			restModel("other", { loadedInstanceIds: ["o1"] }),
		]);
		const result = await loadModelExclusiveViaRest(client, {
			modelId: "target",
			totalRamBytes,
			suitabilityPolicy: { onUnsuitable: "reject", onUnknown: "reject" },
		});
		expect(result.loaded).toBe(false);
		expect(result.reason).toContain("model-capability gate");
		expect(calls).toEqual([]);
	});

	it("uses the REST list's real size_bytes for the headroom check (refuses an over-budget load)", async () => {
		const { client, calls } = fakeRestClient([restModel("target", { sizeBytes: 120 * GiB })]);
		const result = await loadModelExclusiveViaRest(client, { modelId: "target", totalRamBytes });
		expect(result.loaded).toBe(false);
		expect(calls.filter((c) => c.kind === "load")).toEqual([]);
	});

	it("floors the context to ≥32k and caps it to the model's listed max", async () => {
		const floored = fakeRestClient([restModel("target")]);
		await loadModelExclusiveViaRest(floored.client, { modelId: "target", totalRamBytes, contextLength: 8_000 });
		expect(floored.calls.at(-1)?.payload).toEqual({ model: "target", contextLength: 32_000 });

		const capped = fakeRestClient([restModel("target", { maxContextLength: 36_000 })]);
		await loadModelExclusiveViaRest(capped.client, { modelId: "target", totalRamBytes, contextLength: 50_000 });
		expect(capped.calls.at(-1)?.payload).toEqual({ model: "target", contextLength: 36_000 });
	});

	it("is idempotent when the target is already resident (clears others, no re-load)", async () => {
		const { client, calls } = fakeRestClient([
			restModel("target", { loadedInstanceIds: ["t1"] }),
			restModel("other", { loadedInstanceIds: ["o1"] }),
		]);
		const result = await loadModelExclusiveViaRest(client, { modelId: "target", totalRamBytes });
		expect(result.loaded).toBe(true);
		expect(result.reason).toContain("Already resident");
		expect(calls).toEqual([{ kind: "unload", payload: { instanceId: "o1" } }]);
	});

	it("surfaces a REST list failure as a refused load (never throws)", async () => {
		const client: LmStudioRestModelClient = {
			async listModels() {
				return { ok: false, error: { type: "network_error", message: "unreachable" } };
			},
			async loadModel() {
				throw new Error("unused");
			},
			async unloadModel() {
				throw new Error("unused");
			},
			async downloadModel() {
				throw new Error("unused");
			},
		};
		const result = await loadModelExclusiveViaRest(client, { modelId: "target", totalRamBytes });
		expect(result.loaded).toBe(false);
		expect(result.reason).toContain("network_error");
	});
});
