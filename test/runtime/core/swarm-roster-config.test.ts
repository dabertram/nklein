import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_MACHINE_BUDGETS_GB, SWARM_ROSTERS } from "../../../src/core/swarm-roster";
import {
	loadUserSwarmConfig,
	parseUserSwarmConfig,
	resolveEffectiveBudgets,
	resolveEffectiveRosters,
} from "../../../src/core/swarm-roster-config";

const validConfig = {
	machineBudgetsGb: { "mac-studio": 192, "gpu-rig": 16 },
	rosters: [
		{
			id: "mine",
			label: "My fleet",
			assignments: [
				{
					machine: "mac-studio",
					role: "architect",
					model: "some/Model-GGUF",
					quant: "Q4_K_M",
					approxSizeGb: 40,
					note: "",
				},
			],
		},
	],
};

describe("parseUserSwarmConfig", () => {
	it("accepts a well-formed config", () => {
		const parsed = parseUserSwarmConfig(validConfig);
		expect(parsed?.machineBudgetsGb?.["mac-studio"]).toBe(192);
		expect(parsed?.rosters?.[0]?.id).toBe("mine");
	});

	it("accepts a budgets-only override (rosters optional)", () => {
		expect(parseUserSwarmConfig({ machineBudgetsGb: { box: 64 } })?.rosters).toBeUndefined();
	});

	it("fail-soft returns null for a malformed config (bad role, negative size, non-object)", () => {
		expect(
			parseUserSwarmConfig({
				rosters: [
					{
						id: "x",
						label: "x",
						assignments: [{ machine: "m", role: "wizard", model: "y", quant: "q", approxSizeGb: 1 }],
					},
				],
			}),
		).toBeNull();
		expect(parseUserSwarmConfig({ machineBudgetsGb: { box: -8 } })).toBeNull();
		expect(parseUserSwarmConfig("not an object")).toBeNull();
		expect(parseUserSwarmConfig(null)).toBeNull();
	});
});

describe("resolveEffectiveRosters / resolveEffectiveBudgets", () => {
	it("falls back to the shipped examples when config is null or empty", () => {
		expect(resolveEffectiveRosters(null)).toBe(SWARM_ROSTERS);
		expect(resolveEffectiveBudgets(null)).toBe(EXAMPLE_MACHINE_BUDGETS_GB);
		expect(resolveEffectiveRosters({ rosters: [] })).toBe(SWARM_ROSTERS);
		expect(resolveEffectiveBudgets({ machineBudgetsGb: {} })).toBe(EXAMPLE_MACHINE_BUDGETS_GB);
	});

	it("uses the user's data when supplied", () => {
		const config = parseUserSwarmConfig(validConfig);
		expect(resolveEffectiveRosters(config)[0]?.id).toBe("mine");
		expect(resolveEffectiveBudgets(config)["gpu-rig"]).toBe(16);
	});
});

describe("loadUserSwarmConfig", () => {
	it("returns null when the file is absent", async () => {
		expect(await loadUserSwarmConfig(join(tmpdir(), "definitely-absent-swarm-config-xyz.json"))).toBeNull();
	});

	it("returns null for non-JSON content (fail-soft)", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nklein-swarm-cfg-"));
		const path = join(dir, "swarm-rosters.json");
		await writeFile(path, "{ not json", "utf8");
		expect(await loadUserSwarmConfig(path)).toBeNull();
	});

	it("loads + validates a good file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nklein-swarm-cfg-"));
		const path = join(dir, "swarm-rosters.json");
		await writeFile(path, JSON.stringify(validConfig), "utf8");
		const loaded = await loadUserSwarmConfig(path);
		expect(loaded?.rosters?.[0]?.label).toBe("My fleet");
		expect(resolveEffectiveBudgets(loaded)["mac-studio"]).toBe(192);
	});
});
