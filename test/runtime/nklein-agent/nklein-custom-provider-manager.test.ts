import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK-owned provider store + side-effecting helpers; use the REAL local-only policy so the security floor
// (assertLocalProviderAllowed before any persistence) is exercised, not stubbed away.
const sdk = vi.hoisted(() => ({
	addSdkCustomProvider: vi.fn(async () => {}),
	updateSdkCustomProvider: vi.fn(async () => {}),
	deleteSdkCustomProvider: vi.fn(async () => {}),
	getSdkProviderSettings: vi.fn((id: string) => ({ provider: id })),
	getLastUsedSdkProviderSettings: vi.fn(() => null),
	listSdkProviderCatalog: vi.fn(async () => [] as { id: string }[]),
	saveSdkProviderSettings: vi.fn(),
}));
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => sdk);
vi.mock("../../../src/nklein-agent/nklein-provider-selection-store", () => ({
	writeKanbanSelectedProviderId: vi.fn(),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-settings-summary", () => ({
	toProviderSettingsSummary: vi.fn((s: { provider?: string } | null) => ({ provider: s?.provider ?? null })),
}));
vi.mock("../../../src/nklein-agent/nklein-provider-credential-helpers", () => ({
	hasOauthAccessToken: vi.fn(() => false),
}));

import { createCustomProviderManager } from "../../../src/nklein-agent/nklein-custom-provider-manager";
import { writeKanbanSelectedProviderId } from "../../../src/nklein-agent/nklein-provider-selection-store";

const getProviderSettingsSummary = vi.fn(() => ({ provider: "selected" }) as never);
const manager = () => createCustomProviderManager({ getProviderSettingsSummary });

const LOCAL = { name: "Local LLM", baseUrl: "http://localhost:1234/v1", models: ["m1"] };

beforeEach(() => vi.clearAllMocks());

describe("createCustomProviderManager — addCustomProvider", () => {
	it("rejects an empty provider id before touching the store", async () => {
		await expect(manager().addCustomProvider({ providerId: "  ", ...LOCAL })).rejects.toThrow("cannot be empty");
		expect(sdk.addSdkCustomProvider).not.toHaveBeenCalled();
	});

	it("FAILS CLOSED on a cloud provider — the local-only policy throws before any persistence", async () => {
		await expect(
			manager().addCustomProvider({
				providerId: "openrouter",
				name: "x",
				baseUrl: "https://openrouter.ai",
				models: [],
			}),
		).rejects.toThrow();
		expect(sdk.addSdkCustomProvider).not.toHaveBeenCalled();
		expect(sdk.saveSdkProviderSettings).not.toHaveBeenCalled();
	});

	it("rejects a provider id that already exists (no add)", async () => {
		sdk.listSdkProviderCatalog.mockResolvedValueOnce([{ id: "my-llm" }]);
		await expect(manager().addCustomProvider({ providerId: "my-llm", ...LOCAL })).rejects.toThrow("already exists");
		expect(sdk.addSdkCustomProvider).not.toHaveBeenCalled();
	});

	it("adds, persists, and selects a valid local custom provider", async () => {
		const result = await manager().addCustomProvider({ providerId: "my-llm", ...LOCAL });
		expect(sdk.addSdkCustomProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: "my-llm" }));
		expect(sdk.saveSdkProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ setLastUsed: true }));
		expect(writeKanbanSelectedProviderId).toHaveBeenCalledWith("my-llm");
		expect(result).toEqual({ provider: "my-llm" });
	});
});

describe("createCustomProviderManager — update / delete", () => {
	it("updates a local provider and preserves the last-used selection flag", async () => {
		sdk.getLastUsedSdkProviderSettings.mockReturnValueOnce({ provider: "my-llm" } as never);
		await manager().updateCustomProvider({ providerId: "my-llm", baseUrl: "http://localhost:9999" });
		expect(sdk.updateSdkCustomProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: "my-llm" }));
		expect(sdk.saveSdkProviderSettings).toHaveBeenCalledWith(expect.objectContaining({ setLastUsed: true }));
	});

	it("deletes a provider and returns the current selection summary", async () => {
		const result = await manager().deleteCustomProvider({ providerId: "my-llm" });
		expect(sdk.deleteSdkCustomProvider).toHaveBeenCalledWith("my-llm");
		expect(getProviderSettingsSummary).toHaveBeenCalled();
		expect(result).toEqual({ provider: "selected" });
	});

	it("rejects delete/update with an empty id", async () => {
		await expect(manager().deleteCustomProvider({ providerId: "" })).rejects.toThrow("cannot be empty");
		await expect(manager().updateCustomProvider({ providerId: "  " })).rejects.toThrow("cannot be empty");
		expect(sdk.deleteSdkCustomProvider).not.toHaveBeenCalled();
		expect(sdk.updateSdkCustomProvider).not.toHaveBeenCalled();
	});
});
