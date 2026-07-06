import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	areAgentRulesetsEqual,
	areModelSuitabilityPoliciesEqual,
	normalizeDeveloperModeEnabled,
	normalizeModelSuitabilityPolicy,
	normalizeSkillDynamicsLevel,
	readLegacyDeveloperModeEnabled,
	resolveProfileTimeoutDefaults,
} from "../../../src/config/runtime-config-normalizers";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";
import type {
	RuntimeModelSuitabilityPolicy,
	RuntimeSkillDynamicsLevel,
} from "../../../src/core/runtime-config-api-contract";

const cfg = (o: Record<string, unknown>): RuntimeGlobalConfigFileShape => o as RuntimeGlobalConfigFileShape;

describe("readLegacyDeveloperModeEnabled (§5.V coverage)", () => {
	it("reads the legacy debugModeEnabled key, or null when absent", () => {
		expect(readLegacyDeveloperModeEnabled(cfg({ debugModeEnabled: true }))).toBe(true);
		expect(readLegacyDeveloperModeEnabled(cfg({ debugModeEnabled: false }))).toBe(false);
		expect(readLegacyDeveloperModeEnabled(cfg({}))).toBeNull();
		expect(readLegacyDeveloperModeEnabled(null)).toBeNull();
	});
});

describe("normalizeDeveloperModeEnabled (§5.V coverage)", () => {
	const DEBUG_ENV_KEYS = ["NKLEIN_DEBUG", "KANBAN_DEBUG", "KANBAN_DEBUG_MODE", "DEBUG_MODE", "debug_mode"] as const;
	const saved: Record<string, string | undefined> = {};
	beforeEach(() => {
		for (const k of DEBUG_ENV_KEYS) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const k of DEBUG_ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});

	it("prefers the explicit developerModeEnabled flag", () => {
		expect(normalizeDeveloperModeEnabled(cfg({ developerModeEnabled: true }))).toBe(true);
		expect(normalizeDeveloperModeEnabled(cfg({ developerModeEnabled: false }))).toBe(false);
	});

	it("falls back to the legacy debugModeEnabled key when the new flag is absent", () => {
		expect(normalizeDeveloperModeEnabled(cfg({ debugModeEnabled: true }))).toBe(true);
	});

	it("falls back to the debug env override when neither key is present", () => {
		expect(normalizeDeveloperModeEnabled(cfg({}))).toBe(false); // env cleared above
		process.env.NKLEIN_DEBUG = "1";
		expect(normalizeDeveloperModeEnabled(cfg({}))).toBe(true);
	});
});

describe("resolveProfileTimeoutDefaults (§5.V coverage)", () => {
	it("gives the same non-null defaults for cloud and local, and all-null for custom", () => {
		const cloud = resolveProfileTimeoutDefaults("cloud");
		const local = resolveProfileTimeoutDefaults("local");
		expect(cloud).toEqual(local);
		expect(Object.values(cloud).every((v) => typeof v === "number")).toBe(true);
		expect(resolveProfileTimeoutDefaults("custom")).toEqual({
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
		});
	});
});

describe("areAgentRulesetsEqual (§5.V coverage)", () => {
	it("treats undefined and unparseable inputs as equal (both normalize to the default)", () => {
		expect(areAgentRulesetsEqual(undefined, undefined)).toBe(true);
		// Two different garbage inputs both fall back to DEFAULT_AGENT_RULESETS_CONFIG → equal.
		expect(areAgentRulesetsEqual("x" as never, 123 as never)).toBe(true);
	});
});

describe("normalizeModelSuitabilityPolicy / areModelSuitabilityPoliciesEqual (§5.V coverage)", () => {
	const fallback: RuntimeModelSuitabilityPolicy = { onUnsuitable: "reject", onUnknown: "reject" };

	it("returns a valid policy as-is and the fallback for invalid input", () => {
		const valid = { onUnsuitable: "warn", onUnknown: "allow" };
		expect(normalizeModelSuitabilityPolicy(valid, fallback)).toEqual(valid);
		expect(normalizeModelSuitabilityPolicy({ onUnsuitable: "bogus" }, fallback)).toBe(fallback);
		expect(normalizeModelSuitabilityPolicy("nope", fallback)).toBe(fallback);
	});

	it("compares policies structurally (incl. null equality)", () => {
		expect(areModelSuitabilityPoliciesEqual(fallback, { onUnsuitable: "reject", onUnknown: "reject" })).toBe(true);
		expect(areModelSuitabilityPoliciesEqual(fallback, { onUnsuitable: "warn", onUnknown: "reject" })).toBe(false);
		expect(areModelSuitabilityPoliciesEqual(null, null)).toBe(true);
		expect(areModelSuitabilityPoliciesEqual(null, fallback)).toBe(false);
	});
});

describe("normalizeSkillDynamicsLevel (§5.V coverage)", () => {
	const fallback: RuntimeSkillDynamicsLevel = "fully_dynamic";
	it("passes a valid enum level through and falls back on anything else", () => {
		expect(normalizeSkillDynamicsLevel("assigned_skills", fallback)).toBe("assigned_skills");
		expect(normalizeSkillDynamicsLevel("fully_static", fallback)).toBe("fully_static");
		expect(normalizeSkillDynamicsLevel("nonsense", fallback)).toBe(fallback);
		expect(normalizeSkillDynamicsLevel(undefined, fallback)).toBe(fallback);
	});
});
