import { describe, expect, it } from "vitest";
import { setupDeviceRamGbByMachine, setupModelRoleCounts } from "../../../src/core/setup-facts";

describe("setup fact projections (F5.3)", () => {
	it("preserves every configured fleet device instead of parsing a multi-device string as one integer", () => {
		expect(
			setupDeviceRamGbByMachine({
				configuredDeviceRamGb: "m5max:128,m4mini:24,legion5pro:8",
				env: {},
			}),
		).toEqual({ m5max: 128, m4mini: 24, legion5pro: 8 });
	});

	it("keeps the three canonical swarm seats visible before first-run role config exists", () => {
		expect(setupModelRoleCounts({})).toEqual({ assigned: 0, total: 3 });
		expect(setupModelRoleCounts({ architect: { modelId: "model-a" } })).toEqual({ assigned: 1, total: 3 });
	});
});
