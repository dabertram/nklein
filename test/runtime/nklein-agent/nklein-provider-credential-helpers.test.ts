import { describe, expect, it } from "vitest";

import {
	hasOauthAccessToken,
	hasOauthRefreshToken,
	normalizeEpochMs,
	resolveVisibleApiKey,
	toResponseExpirySeconds,
} from "../../../src/nklein-agent/nklein-provider-credential-helpers";
import type { SdkProviderSettings } from "../../../src/nklein-agent/sdk-provider-boundary";

// The helpers only read `.apiKey` and `.auth.*`; the rest of the settings is irrelevant here.
function settings(partial: {
	apiKey?: string;
	auth?: { apiKey?: string; accessToken?: string; refreshToken?: string };
}): SdkProviderSettings {
	return partial as unknown as SdkProviderSettings;
}

describe("resolveVisibleApiKey", () => {
	it("prefers the top-level apiKey, then the nested auth.apiKey", () => {
		expect(resolveVisibleApiKey(settings({ apiKey: "top", auth: { apiKey: "nested" } }))).toBe("top");
		expect(resolveVisibleApiKey(settings({ auth: { apiKey: "nested" } }))).toBe("nested");
	});

	it("returns null for empty / whitespace-only / absent keys", () => {
		expect(resolveVisibleApiKey(settings({ apiKey: "   " }))).toBeNull();
		expect(resolveVisibleApiKey(settings({}))).toBeNull();
		expect(resolveVisibleApiKey(null)).toBeNull();
	});
});

describe("hasOauthAccessToken / hasOauthRefreshToken", () => {
	it("detect a present, non-empty token", () => {
		expect(hasOauthAccessToken(settings({ auth: { accessToken: "tok" } }))).toBe(true);
		expect(hasOauthRefreshToken(settings({ auth: { refreshToken: "tok" } }))).toBe(true);
	});

	it("are false for empty / absent tokens and null settings", () => {
		expect(hasOauthAccessToken(settings({ auth: { accessToken: "  " } }))).toBe(false);
		expect(hasOauthAccessToken(settings({}))).toBe(false);
		expect(hasOauthAccessToken(null)).toBe(false);
		expect(hasOauthRefreshToken(null)).toBe(false);
	});
});

describe("normalizeEpochMs", () => {
	it("treats a value already in milliseconds (>= 1e12) as-is", () => {
		expect(normalizeEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
	});

	it("scales a seconds value (< 1e12) up to milliseconds", () => {
		expect(normalizeEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
	});

	it("floors fractional inputs", () => {
		expect(normalizeEpochMs(1.5)).toBe(1_500);
		expect(normalizeEpochMs(1_700_000_000_000.9)).toBe(1_700_000_000_000);
	});

	it("treats missing / non-finite / non-positive as already-expired (now − 1ms)", () => {
		const before = Date.now();
		for (const bad of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(normalizeEpochMs(bad)).toBeLessThan(before + 1);
		}
	});
});

describe("toResponseExpirySeconds", () => {
	it("converts a ms or seconds expiry to whole seconds", () => {
		expect(toResponseExpirySeconds(1_700_000_000_000)).toBe(1_700_000_000);
		expect(toResponseExpirySeconds(1_700_000_000)).toBe(1_700_000_000);
	});

	it("returns null for a missing / non-positive expiry", () => {
		expect(toResponseExpirySeconds(null)).toBeNull();
		expect(toResponseExpirySeconds(0)).toBeNull();
		expect(toResponseExpirySeconds(-1)).toBeNull();
	});

	it("floors to a minimum of 1 second for a tiny positive expiry", () => {
		// 0.0005s → 0ms → 0s, floored up to the 1s minimum.
		expect(toResponseExpirySeconds(0.0005)).toBe(1);
	});
});
