import { describe, expect, it } from "vitest";

import {
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeTimeoutMsValue,
} from "../../../src/config/runtime-config-normalizers";
import { resolveRuntimeTimeoutConfig } from "../../../src/config/runtime-config-timeout-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const config = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeTimeoutConfig", () => {
	it("maps a null config to each normalizer's default for the right field", () => {
		expect(resolveRuntimeTimeoutConfig(null)).toEqual({
			agentTimeoutMode: normalizeAgentTimeoutMode(undefined),
			agentTimeoutProfile: normalizeAgentTimeoutProfile(undefined),
			requestTimeoutMs: normalizeTimeoutMsValue(undefined),
			streamTimeoutMs: normalizeTimeoutMsValue(undefined),
			toolTimeoutMs: normalizeTimeoutMsValue(undefined),
			agentTimeoutMs: normalizeTimeoutMsValue(undefined),
			conversationTimeoutMs: normalizeTimeoutMsValue(undefined),
		});
	});

	it("routes each source field through its normalizer (distinct per-phase timeouts)", () => {
		const result = resolveRuntimeTimeoutConfig(
			config({
				requestTimeoutMs: 5_000,
				streamTimeoutMs: 6_000,
				toolTimeoutMs: 7_000,
				agentTimeoutMs: 8_000,
				conversationTimeoutMs: 9_000,
			}),
		);
		expect(result.requestTimeoutMs).toBe(normalizeTimeoutMsValue(5_000));
		expect(result.streamTimeoutMs).toBe(normalizeTimeoutMsValue(6_000));
		expect(result.toolTimeoutMs).toBe(normalizeTimeoutMsValue(7_000));
		expect(result.agentTimeoutMs).toBe(normalizeTimeoutMsValue(8_000));
		expect(result.conversationTimeoutMs).toBe(normalizeTimeoutMsValue(9_000));
		// The four per-phase values are independent (not cross-wired).
		expect(new Set(Object.values(result).filter((v) => typeof v === "number")).size).toBe(5);
	});

	it("exposes exactly the seven timeout fields", () => {
		expect(Object.keys(resolveRuntimeTimeoutConfig(null)).sort()).toEqual([
			"agentTimeoutMode",
			"agentTimeoutMs",
			"agentTimeoutProfile",
			"conversationTimeoutMs",
			"requestTimeoutMs",
			"streamTimeoutMs",
			"toolTimeoutMs",
		]);
	});
});
