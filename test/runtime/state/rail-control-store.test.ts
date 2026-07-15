import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DEFAULT_RAIL_CONTROL_SETTINGS,
	loadRailControlSettings,
	type RailControlSettings,
	saveRailControlSettings,
} from "../../../src/state/rail-control-store";

describe("rail-control-store (F1.35b)", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "rail-control-store-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("round-trips control intent + tunables", async () => {
		const settings: RailControlSettings = {
			control: { enabled: true, paused: true, pauseReason: "operator hold" },
			cadenceMs: 120_000,
			maxConcurrentEvals: 2,
		};
		await saveRailControlSettings(settings, { rootDir });
		expect(await loadRailControlSettings({ rootDir })).toEqual(settings);
	});

	it("returns the OFF defaults when no control file exists yet", async () => {
		expect(await loadRailControlSettings({ rootDir })).toEqual(DEFAULT_RAIL_CONTROL_SETTINGS);
		expect(DEFAULT_RAIL_CONTROL_SETTINGS.control.enabled).toBe(false);
	});

	it("recovers at defaults on a corrupt or schema-invalid file (never crashes the boot)", async () => {
		await writeFile(join(rootDir, "rail-control.json"), "{ not json", "utf8");
		expect(await loadRailControlSettings({ rootDir })).toEqual(DEFAULT_RAIL_CONTROL_SETTINGS);

		// Schema-invalid: cadence below the 1s floor is rejected → defaults.
		await writeFile(
			join(rootDir, "rail-control.json"),
			JSON.stringify({
				control: { enabled: true, paused: false, pauseReason: null },
				cadenceMs: 5,
				maxConcurrentEvals: 1,
			}),
			"utf8",
		);
		expect(await loadRailControlSettings({ rootDir })).toEqual(DEFAULT_RAIL_CONTROL_SETTINGS);
	});
});
