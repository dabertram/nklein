import { afterEach, describe, expect, it } from "vitest";
import {
	MANAGED_PROVIDER_ENV_KEYS,
	readEnvApiKey,
	resolveManagedProviderEnvApiKey,
	resolveManagedProviderLaunchApiKey,
} from "../../../src/nklein-agent/nklein-managed-provider-credentials";
import type { SdkProviderSettings } from "../../../src/nklein-agent/sdk-provider-boundary";

const ENV_KEYS = ["NKLEIN_API_KEY", "OCA_API_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
	if (!(key in savedEnv)) {
		savedEnv[key] = process.env[key];
	}
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (key in savedEnv) {
			setEnv(key, savedEnv[key]);
		}
	}
});

describe("readEnvApiKey (§5.U extraction)", () => {
	it("trims a set value and returns null for unset / blank", () => {
		setEnv("NKLEIN_API_KEY", "  sk-abc  ");
		expect(readEnvApiKey("NKLEIN_API_KEY")).toBe("sk-abc");
		setEnv("NKLEIN_API_KEY", "   ");
		expect(readEnvApiKey("NKLEIN_API_KEY")).toBeNull();
		setEnv("NKLEIN_API_KEY", undefined);
		expect(readEnvApiKey("NKLEIN_API_KEY")).toBeNull();
	});
});

describe("resolveManagedProviderEnvApiKey (§5.U extraction)", () => {
	it("returns the first non-blank env key for the provider, else null", () => {
		setEnv("NKLEIN_API_KEY", "sk-nklein");
		expect(resolveManagedProviderEnvApiKey("nklein")).toBe("sk-nklein");
		setEnv("NKLEIN_API_KEY", undefined);
		expect(resolveManagedProviderEnvApiKey("nklein")).toBeNull();
	});

	it("is always null for a provider with no configured env keys (openai-codex)", () => {
		expect(MANAGED_PROVIDER_ENV_KEYS["openai-codex"]).toEqual([]);
		expect(resolveManagedProviderEnvApiKey("openai-codex")).toBeNull();
	});
});

describe("resolveManagedProviderLaunchApiKey (§5.U extraction)", () => {
	const settings = { provider: "nklein" } as SdkProviderSettings;

	it("prefers the oauth key over settings/env", () => {
		setEnv("NKLEIN_API_KEY", "sk-env");
		expect(resolveManagedProviderLaunchApiKey({ providerId: "nklein", settings, oauthApiKey: "sk-oauth" })).toBe(
			"sk-oauth",
		);
	});

	it("falls back to the visible settings key when there is no oauth key", () => {
		setEnv("NKLEIN_API_KEY", undefined);
		const withKey = { provider: "nklein", apiKey: "sk-settings" } as SdkProviderSettings;
		expect(resolveManagedProviderLaunchApiKey({ providerId: "nklein", settings: withKey, oauthApiKey: null })).toBe(
			"sk-settings",
		);
	});

	it("falls back to the env key when neither oauth nor settings provide one", () => {
		setEnv("NKLEIN_API_KEY", "sk-env");
		expect(resolveManagedProviderLaunchApiKey({ providerId: "nklein", settings, oauthApiKey: null })).toBe("sk-env");
	});

	it("throws a sign-in error naming the env vars when nothing resolves", () => {
		setEnv("NKLEIN_API_KEY", undefined);
		expect(() => resolveManagedProviderLaunchApiKey({ providerId: "nklein", settings, oauthApiKey: null })).toThrow(
			/Sign in from Settings or set NKLEIN_API_KEY/,
		);
	});

	it("throws without an env-var hint for a provider that has none (openai-codex)", () => {
		const codexSettings = { provider: "openai-codex" } as SdkProviderSettings;
		expect(() =>
			resolveManagedProviderLaunchApiKey({ providerId: "openai-codex", settings: codexSettings, oauthApiKey: null }),
		).toThrow(/Sign in from Settings before starting/);
	});
});
