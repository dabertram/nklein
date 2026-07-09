import { describe, expect, it } from "vitest";
import { DEFAULT_CODE_EMBEDDING_SETTINGS } from "../../../src/config/runtime-config-defaults";
import {
	areCodeEmbeddingSettingsEqual,
	areModelRolesEqual,
	areSkillDynamicsLevelsEqual,
	normalizeAgentId,
	normalizeAgentRulesets,
	normalizeAgentRulesetsOverride,
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeBoolean,
	normalizeCodeEmbeddingOverride,
	normalizeCodeEmbeddingSettings,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeMaxConcurrentTasksOverride,
	normalizeModelRoles,
	normalizeModelRolesOverride,
	normalizeModelSuitabilityPolicyOverride,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizePromptTemplateWithLegacyDefault,
	normalizeSelectedAgentIdOverride,
	normalizeShortcuts,
	normalizeSkillDynamicsLevelOverride,
	normalizeTimeoutMsValue,
} from "../../../src/config/runtime-config-normalizers";

describe("normalizeBoolean", () => {
	it("returns the boolean as-is; otherwise the fallback", () => {
		expect(normalizeBoolean(true, false)).toBe(true);
		expect(normalizeBoolean(false, true)).toBe(false);
		for (const bad of ["true", 1, 0, null, undefined, {}]) {
			expect(normalizeBoolean(bad, true)).toBe(true);
			expect(normalizeBoolean(bad, false)).toBe(false);
		}
	});
});

describe("integer/number normalizers (explicit fallback)", () => {
	it("normalizePositiveInteger keeps a positive int (truncated), else fallback", () => {
		expect(normalizePositiveInteger(5, 9)).toBe(5);
		expect(normalizePositiveInteger(5.9, 9)).toBe(5);
		for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "5", null, undefined]) {
			expect(normalizePositiveInteger(bad, 9)).toBe(9);
		}
	});
	it("normalizeNonNegativeInteger allows 0 but not negatives", () => {
		expect(normalizeNonNegativeInteger(0, 7)).toBe(0);
		expect(normalizeNonNegativeInteger(3.9, 7)).toBe(3);
		expect(normalizeNonNegativeInteger(-1, 7)).toBe(7);
		expect(normalizeNonNegativeInteger(Number.NaN, 7)).toBe(7);
	});
	it("normalizePositiveNumber keeps a positive (non-truncated) number, else fallback", () => {
		expect(normalizePositiveNumber(2.5, 1)).toBe(2.5);
		expect(normalizePositiveNumber(0, 1)).toBe(1);
		expect(normalizePositiveNumber(-0.1, 1)).toBe(1);
		expect(normalizePositiveNumber("2", 1)).toBe(1);
	});
});

describe("concurrency normalizers", () => {
	it("normalizeMaxConcurrentTasks returns a positive default for invalid/non-positive input", () => {
		const def = normalizeMaxConcurrentTasks("nope");
		expect(def).toBeGreaterThan(0);
		expect(normalizeMaxConcurrentTasks(-1)).toBe(def);
		expect(normalizeMaxConcurrentTasks(Number.NaN)).toBe(def);
		expect(normalizeMaxConcurrentTasks(4)).toBe(4);
		expect(normalizeMaxConcurrentTasks(4.9)).toBe(4);
	});
	it("normalizeMaxConcurrentTasksOverride is null for absent/invalid/non-positive, else the truncated int", () => {
		for (const none of [null, undefined, "3", Number.NaN, 0, -2]) {
			expect(normalizeMaxConcurrentTasksOverride(none)).toBeNull();
		}
		expect(normalizeMaxConcurrentTasksOverride(6.7)).toBe(6);
	});
});

describe("timeout normalizers", () => {
	it("normalizeTimeoutMsValue: null→null, finite ≥0 →truncated, negatives/NaN/strings →null", () => {
		expect(normalizeTimeoutMsValue(null)).toBeNull();
		expect(normalizeTimeoutMsValue(0)).toBe(0);
		expect(normalizeTimeoutMsValue(1500.9)).toBe(1500);
		for (const bad of [-1, Number.NaN, "1000", undefined]) {
			expect(normalizeTimeoutMsValue(bad)).toBeNull();
		}
	});
	it("normalizeAgentTimeoutMode passes valid modes, maps legacy very_long→extended, else default", () => {
		for (const mode of ["normal", "long", "extended", "unlimited"] as const) {
			expect(normalizeAgentTimeoutMode(mode)).toBe(mode);
		}
		expect(normalizeAgentTimeoutMode("very_long")).toBe("extended");
		expect(normalizeAgentTimeoutMode("bogus")).toBe(normalizeAgentTimeoutMode(undefined));
	});
	it("normalizeAgentTimeoutProfile passes cloud/local/custom, else a stable default", () => {
		for (const profile of ["cloud", "local", "custom"] as const) {
			expect(normalizeAgentTimeoutProfile(profile)).toBe(profile);
		}
		expect(normalizeAgentTimeoutProfile("bogus")).toBe(normalizeAgentTimeoutProfile(null));
	});
});

describe("agent-id normalizers", () => {
	it("normalizeAgentId keeps nklein and maps unknown/absent to a stable default", () => {
		expect(normalizeAgentId("nklein")).toBe("nklein");
		const def = normalizeAgentId(null);
		expect(normalizeAgentId("bogus")).toBe(def);
		expect(normalizeAgentId(undefined)).toBe(def);
	});
	it("normalizeSelectedAgentIdOverride: null for absent/unknown/default-equal, else the known id", () => {
		expect(normalizeSelectedAgentIdOverride(null)).toBeNull();
		expect(normalizeSelectedAgentIdOverride(undefined)).toBeNull();
		expect(normalizeSelectedAgentIdOverride("bogus")).toBeNull();
		// nklein is the local-only default ⇒ stored as null (no-op override); a different known id is preserved.
		expect(normalizeSelectedAgentIdOverride("nklein")).toBeNull();
		expect(normalizeSelectedAgentIdOverride("codex")).toBe("codex");
	});
});

describe("normalizeLostHeartbeatPolicy", () => {
	it("returns keep_running only for that literal, else a stable default", () => {
		expect(normalizeLostHeartbeatPolicy("keep_running")).toBe("keep_running");
		expect(normalizeLostHeartbeatPolicy("bogus")).toBe(normalizeLostHeartbeatPolicy(undefined));
		expect(normalizeLostHeartbeatPolicy("bogus")).not.toBe("keep_running");
	});
});

describe("normalizeShortcuts", () => {
	it("returns [] for a non-array (corrupt config)", () => {
		// biome-ignore lint/suspicious/noExplicitAny: exercising untrusted config input
		expect(normalizeShortcuts("nope" as any)).toEqual([]);
		expect(normalizeShortcuts(null)).toEqual([]);
		expect(normalizeShortcuts(undefined)).toEqual([]);
	});

	it("drops entries missing a label or command and trims the survivors", () => {
		const out = normalizeShortcuts([
			{ label: "  Build  ", command: "  npm run build  ", icon: "  🔨  " },
			{ label: "", command: "x" },
			{ label: "NoCmd", command: "   " },
			// biome-ignore lint/suspicious/noExplicitAny: garbage entry among valid ones
			"garbage" as any,
		]);
		expect(out).toEqual([{ label: "Build", command: "npm run build", icon: "🔨" }]);
	});

	it("omits an empty icon rather than storing a blank string", () => {
		const out = normalizeShortcuts([{ label: "L", command: "C", icon: "   " }]);
		expect(out).toEqual([{ label: "L", command: "C", icon: undefined }]);
	});
});

describe("normalizeModelRoles", () => {
	it("returns {} for a non-object, array, or null", () => {
		expect(normalizeModelRoles("x")).toEqual({});
		expect(normalizeModelRoles(["a"])).toEqual({});
		expect(normalizeModelRoles(null)).toEqual({});
	});

	it("keeps a valid role (trimming provider/model) and skips a blank role key", () => {
		const out = normalizeModelRoles({
			"  coder  ": { providerId: "  lmstudio  ", modelId: "  qwen  " },
			"   ": { providerId: "p", modelId: "m" },
		});
		expect(out.coder).toEqual({ providerId: "lmstudio", modelId: "qwen" });
		expect(Object.keys(out)).toEqual(["coder"]);
	});

	it("drops pool members that carry neither providerId nor modelId", () => {
		const out = normalizeModelRoles({
			coder: {
				providerId: "p",
				modelId: "m",
				additionalModels: [{ providerId: "p2", modelId: "m2" }, { reasoningEffort: "high" }],
			},
		});
		expect(out.coder?.additionalModels).toEqual([{ providerId: "p2", modelId: "m2" }]);
	});

	it("§5.I#4: keeps a non-default speedVsCapability dial and drops the implicit 'capability' default", () => {
		const out = normalizeModelRoles({
			fast: { providerId: "p", modelId: "m", speedVsCapability: "speed" },
			plain: { providerId: "p", modelId: "m", speedVsCapability: "capability" },
			invalid: { providerId: "p", modelId: "m", speedVsCapability: "warp" },
		});
		expect(out.fast?.speedVsCapability).toBe("speed");
		expect(out.plain?.speedVsCapability).toBeUndefined(); // default not persisted
		expect(out.invalid).toBeUndefined(); // schema-invalid role entry skipped entirely
	});

	it("keeps explicit pinned model selection only when a concrete primary model id is configured", () => {
		const out = normalizeModelRoles({
			pinned: { providerId: "p", modelId: "m", modelSelectionMode: "pinned" },
			auto: { providerId: "p", modelId: "m", modelSelectionMode: "auto" },
			providerOnlyPin: { providerId: "p", modelSelectionMode: "pinned" },
			emptyPin: { modelSelectionMode: "pinned" },
		});
		expect(out.pinned).toEqual({ providerId: "p", modelId: "m", modelSelectionMode: "pinned" });
		expect(out.auto).toEqual({ providerId: "p", modelId: "m" });
		expect(out.providerOnlyPin).toEqual({ providerId: "p" });
		expect(out.emptyPin).toBeUndefined();
	});

	it("normalizeModelRolesOverride collapses an empty/absent map to null", () => {
		expect(normalizeModelRolesOverride(null)).toBeNull();
		expect(normalizeModelRolesOverride(undefined)).toBeNull();
		expect(normalizeModelRolesOverride({})).toBeNull();
		expect(normalizeModelRolesOverride({ coder: { providerId: "p", modelId: "m" } })).not.toBeNull();
	});

	it("areModelRolesEqual compares by normalized value, not reference", () => {
		expect(
			areModelRolesEqual({ coder: { providerId: "p", modelId: "m" } }, { coder: { providerId: "p", modelId: "m" } }),
		).toBe(true);
		expect(areModelRolesEqual({ coder: { providerId: "p", modelId: "m" } }, {})).toBe(false);
	});
});

describe("normalizePromptTemplateWithLegacyDefault", () => {
	it("falls back for a non-string or whitespace-only value", () => {
		expect(normalizePromptTemplateWithLegacyDefault(42, "FB", "LEGACY")).toBe("FB");
		expect(normalizePromptTemplateWithLegacyDefault("   ", "FB", "LEGACY")).toBe("FB");
	});

	it("maps a value equal to the legacy default onto the current fallback", () => {
		expect(normalizePromptTemplateWithLegacyDefault("LEGACY", "FB", "LEGACY")).toBe("FB");
	});

	it("preserves a real custom value verbatim, including its surrounding whitespace", () => {
		expect(normalizePromptTemplateWithLegacyDefault("  hello  ", "FB", "LEGACY")).toBe("  hello  ");
	});
});

describe("code-embedding + policy override normalizers", () => {
	it("normalizeCodeEmbeddingSettings falls back for garbage and forces the default for local_lexical", () => {
		expect(normalizeCodeEmbeddingSettings("garbage", DEFAULT_CODE_EMBEDDING_SETTINGS)).toEqual(
			DEFAULT_CODE_EMBEDDING_SETTINGS,
		);
		expect(normalizeCodeEmbeddingSettings({ provider: "local_lexical" }, DEFAULT_CODE_EMBEDDING_SETTINGS)).toEqual(
			DEFAULT_CODE_EMBEDDING_SETTINGS,
		);
	});

	it("normalizeCodeEmbeddingSettings trims an openai_compatible model/baseUrl and nulls blanks", () => {
		expect(
			normalizeCodeEmbeddingSettings(
				{ provider: "openai_compatible", model: "  text-embed  ", baseUrl: "   " },
				DEFAULT_CODE_EMBEDDING_SETTINGS,
			),
		).toEqual({ provider: "openai_compatible", model: "text-embed", baseUrl: null });
	});

	it("normalizeCodeEmbeddingOverride returns null for null/undefined", () => {
		expect(normalizeCodeEmbeddingOverride(null)).toBeNull();
		expect(normalizeCodeEmbeddingOverride(undefined)).toBeNull();
	});

	it("areCodeEmbeddingSettingsEqual compares structurally", () => {
		expect(areCodeEmbeddingSettingsEqual(DEFAULT_CODE_EMBEDDING_SETTINGS, DEFAULT_CODE_EMBEDDING_SETTINGS)).toBe(
			true,
		);
		expect(
			areCodeEmbeddingSettingsEqual(DEFAULT_CODE_EMBEDDING_SETTINGS, {
				provider: "openai_compatible",
				model: "x",
				baseUrl: null,
			}),
		).toBe(false);
	});

	it("suitability + skill-dynamics overrides reject invalid input and null out no-ops", () => {
		expect(normalizeModelSuitabilityPolicyOverride(null)).toBeNull();
		expect(normalizeModelSuitabilityPolicyOverride("garbage")).toBeNull();
		expect(normalizeSkillDynamicsLevelOverride(undefined)).toBeNull();
		expect(normalizeSkillDynamicsLevelOverride({ bogus: true })).toBeNull();
	});

	it("areSkillDynamicsLevelsEqual is a plain identity compare", () => {
		const a = normalizeSkillDynamicsLevelOverride(null);
		expect(areSkillDynamicsLevelsEqual(a, a)).toBe(true);
	});
});

describe("normalizeAgentRulesets", () => {
	it("returns the default for garbage and treats a garbage override as a no-op (null)", () => {
		// Any invalid value normalizes to the shared default...
		expect(normalizeAgentRulesets("garbage")).toEqual(normalizeAgentRulesets(undefined));
		// ...and an override equal to the default is stored as null to keep the file clean.
		expect(normalizeAgentRulesetsOverride("garbage")).toBeNull();
		expect(normalizeAgentRulesetsOverride(null)).toBeNull();
	});
});
