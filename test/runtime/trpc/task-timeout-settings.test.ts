import { describe, expect, it } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { resolveEffectiveTaskTimeoutSettings } from "../../../src/trpc/runtime-api/task-timeout-settings";

function config(over: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		agentTimeoutProfile: "cloud",
		agentTimeoutMode: "normal",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		...over,
	} as RuntimeConfigState;
}

describe("resolveEffectiveTaskTimeoutSettings", () => {
	it("falls back to the cloud profile defaults (autonomous_default source) with no overrides", () => {
		const result = resolveEffectiveTaskTimeoutSettings({ runtimeConfig: config() });
		expect(result.requestTimeoutMs).toBe(60 * 60 * 1000);
		expect(result.conversationTimeoutMs).toBe(7 * 24 * 60 * 60 * 1000);
		expect(result.streamTimeoutSource).toBe("autonomous_default");
		expect(result.timeoutProfile).toBe("cloud");
	});

	it("scales by the timeout mode (long=3×, extended=6×) and unlimited clears all bounds", () => {
		expect(
			resolveEffectiveTaskTimeoutSettings({ runtimeConfig: config({ agentTimeoutMode: "long" }) }).requestTimeoutMs,
		).toBe(3 * 60 * 60 * 1000);
		expect(
			resolveEffectiveTaskTimeoutSettings({ runtimeConfig: config({ agentTimeoutMode: "extended" }) })
				.requestTimeoutMs,
		).toBe(6 * 60 * 60 * 1000);
		const unlimited = resolveEffectiveTaskTimeoutSettings({
			runtimeConfig: config({ agentTimeoutMode: "unlimited" }),
		});
		expect(unlimited.requestTimeoutMs).toBeNull();
		expect(unlimited.conversationTimeoutMs).toBeNull();
	});

	it("honors the precedence task-override > global-config > profile-default", () => {
		// task override wins + records role_override
		const taskWins = resolveEffectiveTaskTimeoutSettings({
			runtimeConfig: config({ streamTimeoutMs: 999_999 }),
			taskSettings: { streamTimeoutMs: 120_000 },
		});
		expect(taskWins.streamTimeoutMs).toBe(120_000);
		expect(taskWins.streamTimeoutSource).toBe("role_override");
		// global config wins over the profile default + records global_config
		const globalWins = resolveEffectiveTaskTimeoutSettings({ runtimeConfig: config({ toolTimeoutMs: 500_000 }) });
		expect(globalWins.toolTimeoutMs).toBe(500_000);
		expect(globalWins.toolTimeoutSource).toBe("global_config");
	});

	it("enforces the local-NKlein 60s floor on a positive value but leaves 0 (no bound) alone", () => {
		const floored = resolveEffectiveTaskTimeoutSettings({
			runtimeConfig: config({ agentTimeoutProfile: "custom" }),
			taskSettings: { requestTimeoutMs: 30_000 },
		});
		expect(floored.requestTimeoutMs).toBe(60 * 1000); // floored up from 30s
		const zero = resolveEffectiveTaskTimeoutSettings({
			runtimeConfig: config(),
			taskSettings: { requestTimeoutMs: 0 },
		});
		expect(zero.requestTimeoutMs).toBe(0); // 0 = no bound, not floored
	});
});
