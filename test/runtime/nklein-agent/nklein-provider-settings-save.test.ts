import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK store + side-effecting helpers; use the REAL local-only policy / id-classification / context-window
// policy so the security floor (assertLocalProviderAllowed before persistence) and validation run for real.
const sdk = vi.hoisted(() => ({
	getSdkProviderSettings: vi.fn((_id: string) => undefined as Record<string, unknown> | undefined),
	saveSdkProviderSettings: vi.fn(),
}));
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => sdk);
vi.mock("../../../src/nklein-agent/nklein-provider-selection-store", () => ({
	writeKanbanSelectedProviderId: vi.fn(),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-settings-summary", () => ({
	toProviderSettingsSummary: vi.fn((s: { provider?: string }) => ({ provider: s?.provider ?? null })),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-credential-helpers", () => ({
	hasOauthAccessToken: vi.fn(() => false),
}));

import { writeKanbanSelectedProviderId } from "../../../src/nklein-agent/nklein-provider-selection-store";
import {
	createProviderSettingsWriter,
	type ProviderSettingsWriterDeps,
} from "../../../src/nklein-agent/nklein-provider-settings-save";

const writer = (over: Partial<ProviderSettingsWriterDeps> = {}) =>
	createProviderSettingsWriter({ loadProviderModelsWithMeasuredWindows: vi.fn(async () => []), ...over });

// The settings object handed to saveSdkProviderSettings on the most recent call.
const savedSettings = () =>
	(sdk.saveSdkProviderSettings.mock.calls.at(-1)?.[0] as { settings: Record<string, unknown> })?.settings;

beforeEach(() => vi.clearAllMocks());

describe("createProviderSettingsWriter — validation + security", () => {
	it("rejects an empty provider id before touching the store", async () => {
		await expect(writer().saveProviderSettings({ providerId: "   " })).rejects.toThrow("cannot be empty");
		expect(sdk.saveSdkProviderSettings).not.toHaveBeenCalled();
	});

	it("FAILS CLOSED on a cloud provider — the local-only policy throws before persistence", async () => {
		await expect(
			writer().saveProviderSettings({ providerId: "openrouter", baseUrl: "https://openrouter.ai" }),
		).rejects.toThrow();
		expect(sdk.saveSdkProviderSettings).not.toHaveBeenCalled();
	});

	it("rejects a Vertex save with no GCP project id (before persistence)", async () => {
		await expect(writer().saveProviderSettings({ providerId: "vertex" })).rejects.toThrow("GCP Project ID");
		expect(sdk.saveSdkProviderSettings).not.toHaveBeenCalled();
	});
});

describe("createProviderSettingsWriter — field normalization + persistence", () => {
	it("persists a valid local provider and selects it", async () => {
		const result = await writer().saveProviderSettings({ providerId: "my-llm", baseUrl: "http://localhost:1234" });
		expect(sdk.saveSdkProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ setLastUsed: true }));
		expect(savedSettings()).toMatchObject({ provider: "my-llm", baseUrl: "http://localhost:1234" });
		expect(writeKanbanSelectedProviderId).toHaveBeenCalledWith("my-llm");
		expect(result).toEqual({ provider: "my-llm" });
	});

	it("trims apiKey and deletes fields set to blank", async () => {
		sdk.getSdkProviderSettings.mockReturnValueOnce({
			provider: "my-llm",
			baseUrl: "http://localhost:1234",
			region: "old-region",
		});
		// Keep a valid local baseUrl (custom providers need a local endpoint to pass the lockdown); trim apiKey, blank region.
		await writer().saveProviderSettings({
			providerId: "my-llm",
			baseUrl: "http://localhost:1234",
			apiKey: "  fresh-key  ",
			region: "",
		});
		const s = savedSettings();
		expect(s.apiKey).toBe("fresh-key"); // trimmed
		expect(s.region).toBeUndefined(); // blank ⇒ deleted
	});

	it("strips managed-OAuth auth from a non-managed provider", async () => {
		sdk.getSdkProviderSettings.mockReturnValueOnce({
			provider: "my-llm",
			baseUrl: "http://localhost:1234",
			auth: { accessToken: "x" },
		});
		await writer().saveProviderSettings({ providerId: "my-llm", baseUrl: "http://localhost:1234" });
		expect(savedSettings().auth).toBeUndefined();
	});
});
