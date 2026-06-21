import { describe, expect, it } from "vitest";

import {
	AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
	withAutonomousNKleinTimeoutSettings,
} from "../../../src/core/autonomous-timeout-defaults";

describe("autonomous timeout defaults", () => {
	it("adds bounded timeout settings when none are provided", () => {
		expect(withAutonomousNKleinTimeoutSettings()).toEqual(AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS);
	});

	it("preserves model settings while filling missing bounded timeouts", () => {
		expect(
			withAutonomousNKleinTimeoutSettings({
				providerId: "lmstudio",
				modelId: "qwen3.5-9b",
				streamTimeoutMs: 120_000,
			}),
		).toEqual({
			...AUTONOMOUS_NKLEIN_TIMEOUT_SETTINGS,
			providerId: "lmstudio",
			modelId: "qwen3.5-9b",
			streamTimeoutMs: 120_000,
		});
	});

	it("preserves explicit unlimited timeout mode", () => {
		expect(
			withAutonomousNKleinTimeoutSettings({
				providerId: "lmstudio",
				modelId: "qwen3.5-9b",
				timeoutMode: "unlimited",
			}),
		).toEqual({
			providerId: "lmstudio",
			modelId: "qwen3.5-9b",
			timeoutMode: "unlimited",
		});
	});
});
