import { describe, expect, it } from "vitest";
import {
	createEmptyProviderSettingsSummary,
	toProviderSettingsSummary,
	toRuntimeReasoningEffort,
} from "../../../src/nklein-agent/nklein-provider-settings-summary";
import type { SdkProviderSettings } from "../../../src/nklein-agent/sdk-provider-boundary";

describe("toRuntimeReasoningEffort (§5.U extraction)", () => {
	it("collapses 'none' / null / undefined to null and passes a real effort through", () => {
		expect(toRuntimeReasoningEffort("none")).toBeNull();
		expect(toRuntimeReasoningEffort(null)).toBeNull();
		expect(toRuntimeReasoningEffort(undefined)).toBeNull();
		expect(toRuntimeReasoningEffort("high")).toBe("high");
		expect(toRuntimeReasoningEffort("low")).toBe("low");
	});
});

describe("createEmptyProviderSettingsSummary / toProviderSettingsSummary (§5.U extraction)", () => {
	it("the empty summary has every value null and every 'configured?' flag false", () => {
		expect(createEmptyProviderSettingsSummary()).toEqual({
			providerId: null,
			modelId: null,
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
	});

	it("null settings ⇒ the empty summary", () => {
		expect(toProviderSettingsSummary(null)).toEqual(createEmptyProviderSettingsSummary());
	});

	it("trims provider/model/baseUrl and maps the reasoning effort", () => {
		const summary = toProviderSettingsSummary({
			provider: "  lmstudio  ",
			model: "  qwen3.6-27b  ",
			baseUrl: "  http://localhost:1234  ",
			reasoning: { effort: "high" },
		} as SdkProviderSettings);
		expect(summary.providerId).toBe("lmstudio");
		expect(summary.modelId).toBe("qwen3.6-27b");
		expect(summary.baseUrl).toBe("http://localhost:1234");
		expect(summary.reasoningEffort).toBe("high");
	});

	it("reports credential PRESENCE (booleans), never the values — none configured ⇒ all false", () => {
		const summary = toProviderSettingsSummary({ provider: "lmstudio", model: "m" } as SdkProviderSettings);
		expect(summary.apiKeyConfigured).toBe(false);
		expect(summary.oauthAccessTokenConfigured).toBe(false);
		expect(summary.oauthRefreshTokenConfigured).toBe(false);
		// The summary DTO never carries a raw key/token field.
		expect(Object.keys(summary)).not.toContain("apiKey");
	});

	it("blank strings normalize to null (empty provider/model/baseUrl)", () => {
		const summary = toProviderSettingsSummary({ provider: "   ", model: "  ", baseUrl: "" } as SdkProviderSettings);
		expect(summary.providerId).toBeNull();
		expect(summary.modelId).toBeNull();
		expect(summary.baseUrl).toBeNull();
	});
});
