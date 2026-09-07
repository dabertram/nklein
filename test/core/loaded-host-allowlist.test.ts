import { afterEach, describe, expect, it } from "vitest";
import {
	filterByLoadedHostAllowlist,
	getLoadedHostAllowlist,
	isModelIdAllowedByLoadedHostAllowlist,
	resetLoadedHostAllowlistForTests,
	resolveMachineIdForIds,
	setLoadedHostAllowlist,
} from "../../src/core/loaded-host-allowlist";

const LEGION = "040891f3ad9352c2ec9389aba79cd022";
const M4MINI = "2d30f46d0371d004b1758e6df7790a03";

const machineByModelId = new Map<string, string>([
	["dirk-qwen3.8-27b", LEGION],
	["dirk-qwen3.8-27b@q6_k", LEGION],
	["dirk-qwen3.8-27b@m4mini", M4MINI],
	["dirk-qwen3.8-27b@q2_k_xl", M4MINI],
	["qwen3.8-flash-next", "local"],
]);

const descriptors = [
	{ runtimeId: "qwen3.8-flash-next", modelKey: "qwen3.8-flash-next" },
	{ runtimeId: "dirk-qwen3.8-27b", modelKey: "dirk-qwen3.8-27b@q6_k" },
	{ runtimeId: "dirk-qwen3.8-27b@m4mini", modelKey: "dirk-qwen3.8-27b@q2_k_xl" },
	{ runtimeId: "mystery-model", modelKey: "mystery-model" },
];

describe("loaded-host allowlist (David 2026-09-07: m5max idle for !Klein)", () => {
	afterEach(() => resetLoadedHostAllowlistForTests());

	it("keeps everything when no allowlist is set", () => {
		const result = filterByLoadedHostAllowlist(descriptors, {
			allowlist: new Set(),
			machineIdByModelId: machineByModelId,
			idsOf: (d) => [d.runtimeId, d.modelKey],
		});
		expect(result.kept).toHaveLength(4);
		expect(result.excluded).toEqual([]);
	});

	it("excludes the local host's model AND unmapped models when the allowlist names only remote hosts", () => {
		const result = filterByLoadedHostAllowlist(descriptors, {
			allowlist: new Set([LEGION, M4MINI]),
			machineIdByModelId: machineByModelId,
			idsOf: (d) => [d.runtimeId, d.modelKey],
		});
		expect(result.kept.map((d) => d.runtimeId)).toEqual(["dirk-qwen3.8-27b", "dirk-qwen3.8-27b@m4mini"]);
		// flash-next sits on m5max (local); the mystery model is unmapped ⇒ treated as local ⇒ excluded (fail-closed).
		expect(result.excluded).toEqual([
			{ id: "qwen3.8-flash-next", machineId: "local" },
			{ id: "mystery-model", machineId: "local" },
		]);
	});

	it("resolves the machine through any alias (model key when the runtime id is unmapped)", () => {
		expect(resolveMachineIdForIds(["not-mapped", "dirk-qwen3.8-27b@q2_k_xl"], machineByModelId)).toBe(M4MINI);
		expect(resolveMachineIdForIds(["", null, undefined], machineByModelId)).toBe("local");
	});

	it("single-id check mirrors the filter", () => {
		const input = { allowlist: new Set([LEGION]), machineIdByModelId: machineByModelId };
		expect(isModelIdAllowedByLoadedHostAllowlist("dirk-qwen3.8-27b", input)).toBe(true);
		expect(isModelIdAllowedByLoadedHostAllowlist("qwen3.8-flash-next", input)).toBe(false);
		expect(isModelIdAllowedByLoadedHostAllowlist("qwen3.8-flash-next", { ...input, allowlist: new Set() })).toBe(
			true,
		);
	});

	it("the registry normalizes, dedupes and trims what the config resolver publishes", () => {
		expect(setLoadedHostAllowlist([` ${LEGION} `, M4MINI, M4MINI, 42, "", null])).toEqual([LEGION, M4MINI]);
		expect([...getLoadedHostAllowlist()]).toEqual([LEGION, M4MINI]);
		expect(setLoadedHostAllowlist(undefined)).toEqual([]);
		expect(getLoadedHostAllowlist().size).toBe(0);
	});
});
