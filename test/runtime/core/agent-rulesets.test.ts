import { describe, expect, it } from "vitest";
import {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_CAPABILITY_TIERS,
	AGENT_DELIVERY_TIER_INFO,
	AGENT_DELIVERY_TIERS,
	type AgentRulesetsConfig,
	capabilitiesForTier,
	DEFAULT_AGENT_CAPABILITY_TIER,
	DEFAULT_AGENT_DELIVERY_TIER,
	DEFAULT_AGENT_RULESETS_CONFIG,
	deliveryPolicyForTier,
	resolveCapabilityTier,
	resolveDeliveryTier,
	resolveEffectiveAgentRuleset,
} from "../../../src/core/agent-rulesets";
import { agentRulesetsConfigSchema } from "../../../src/core/api-contract";

describe("agent-rulesets capability matrix", () => {
	it("defaults to the most open tier", () => {
		expect(DEFAULT_AGENT_CAPABILITY_TIER).toBe("fully_open");
		expect(DEFAULT_AGENT_DELIVERY_TIER).toBe("fully_open");
	});

	it("keeps the sandbox fully offline at the strictest tier", () => {
		expect(capabilitiesForTier("strict")).toEqual({
			network: "none",
			webResearch: false,
			headlessBrowser: false,
			mcp: "off",
		});
	});

	it("opens full network + all tools only at the open tiers", () => {
		expect(capabilitiesForTier("fully_open")).toEqual({
			network: "full",
			webResearch: true,
			headlessBrowser: true,
			mcp: "on",
		});
		// The headless browser only appears once network is full.
		expect(capabilitiesForTier("medium").headlessBrowser).toBe(false);
		expect(capabilitiesForTier("medium").network).toBe("allowlist");
	});

	it("never enables a web tool while the network is none", () => {
		for (const tier of AGENT_CAPABILITY_TIERS) {
			const caps = capabilitiesForTier(tier);
			if (caps.network === "none") {
				expect(caps.webResearch).toBe(false);
				expect(caps.headlessBrowser).toBe(false);
			}
		}
	});

	it("has tier info copy for every tier", () => {
		for (const tier of AGENT_CAPABILITY_TIERS) {
			expect(AGENT_CAPABILITY_TIER_INFO[tier].label.length).toBeGreaterThan(0);
			expect(AGENT_CAPABILITY_TIER_INFO[tier].description.length).toBeGreaterThan(0);
		}
		for (const tier of AGENT_DELIVERY_TIERS) {
			expect(AGENT_DELIVERY_TIER_INFO[tier].label.length).toBeGreaterThan(0);
		}
	});
});

describe("agent-rulesets delivery matrix", () => {
	it("automates nothing at the strictest tier", () => {
		expect(deliveryPolicyForTier("strict")).toEqual({
			autoCommit: false,
			autoOpenPr: false,
			autoMerge: false,
			allowSelfMergeOnUnknownDelta: false,
		});
	});

	it("permits self-merge on unknown delta only at the fully open tier", () => {
		expect(deliveryPolicyForTier("more_open").autoMerge).toBe(true);
		expect(deliveryPolicyForTier("more_open").allowSelfMergeOnUnknownDelta).toBe(false);
		expect(deliveryPolicyForTier("fully_open").allowSelfMergeOnUnknownDelta).toBe(true);
	});

	it("requires a human merge below the open tiers", () => {
		expect(deliveryPolicyForTier("medium").autoMerge).toBe(false);
		expect(deliveryPolicyForTier("medium").autoOpenPr).toBe(true);
		expect(deliveryPolicyForTier("less_strict").autoCommit).toBe(true);
		expect(deliveryPolicyForTier("less_strict").autoOpenPr).toBe(false);
	});
});

describe("agent-rulesets resolution", () => {
	it("falls back to defaults when no config is provided", () => {
		expect(resolveCapabilityTier(undefined, "worker")).toBe("fully_open");
		expect(resolveDeliveryTier(undefined, "worker")).toBe("fully_open");
	});

	it("uses the global preset when there is no role override", () => {
		expect(resolveCapabilityTier({ globalPreset: "strict" }, "worker")).toBe("strict");
	});

	it("lets a role override win over the global preset", () => {
		const config = { globalPreset: "strict" as const, roleOverrides: { worker: "more_open" as const } };
		expect(resolveCapabilityTier(config, "worker")).toBe("more_open");
		// A role without an override still gets the global preset.
		expect(resolveCapabilityTier(config, "architect")).toBe("strict");
	});

	it("falls back to the global preset for unknown role strings", () => {
		const config = { globalPreset: "medium" as const, roleOverrides: { worker: "strict" as const } };
		expect(resolveCapabilityTier(config, "unknown")).toBe("medium");
		expect(resolveCapabilityTier(config, "")).toBe("medium");
	});

	it("composes both dials into an effective ruleset", () => {
		const effective = resolveEffectiveAgentRuleset(
			{
				capability: { globalPreset: "strict", roleOverrides: { reviewer: "medium" } },
				delivery: { globalPreset: "fully_open" },
			},
			"reviewer",
		);
		expect(effective.capabilityTier).toBe("medium");
		expect(effective.capabilities.network).toBe("allowlist");
		expect(effective.deliveryTier).toBe("fully_open");
		expect(effective.delivery.allowSelfMergeOnUnknownDelta).toBe(true);
	});
});

describe("agent-rulesets api-contract schema agrees with the core", () => {
	it("accepts the core default config", () => {
		expect(agentRulesetsConfigSchema.parse(DEFAULT_AGENT_RULESETS_CONFIG)).toEqual(DEFAULT_AGENT_RULESETS_CONFIG);
	});

	it("accepts per-role overrides and a parsed payload feeds the core resolver", () => {
		const parsed = agentRulesetsConfigSchema.parse({
			capability: { globalPreset: "strict", roleOverrides: { worker: "more_open" } },
			delivery: { globalPreset: "medium" },
		});
		// The parsed contract payload must be usable as the core config type without conversion.
		const config: AgentRulesetsConfig = parsed;
		expect(resolveEffectiveAgentRuleset(config, "worker").capabilities.headlessBrowser).toBe(true);
		expect(resolveEffectiveAgentRuleset(config, "architect").capabilityTier).toBe("strict");
		expect(resolveEffectiveAgentRuleset(config, "worker").delivery.autoMerge).toBe(false);
	});

	it("rejects an unknown tier value", () => {
		expect(() =>
			agentRulesetsConfigSchema.parse({
				capability: { globalPreset: "wide-open" },
				delivery: { globalPreset: "strict" },
			}),
		).toThrow();
	});
});
