import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/nklein-agent/nklein-provider-selection-store", () => ({
	readKanbanSelectedProviderId: vi.fn(),
	writeKanbanSelectedProviderId: vi.fn(),
}));
vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => ({
	// Force the fallback `{ provider: id }` path so isLocalProvider (real) decides purely from the id.
	getSdkProviderSettings: vi.fn(() => undefined),
	// The 2026-09-06 heal consults these when no provider is selected; nothing to derive here.
	getLastUsedSdkProviderSettings: vi.fn(() => null),
	saveSdkProviderSettings: vi.fn(),
}));

import {
	getSelectedProviderSettings,
	toProviderServiceErrorMessage,
} from "../../../src/nklein-agent/nklein-provider-selected-settings";
import { readKanbanSelectedProviderId } from "../../../src/nklein-agent/nklein-provider-selection-store";

const mockedRead = vi.mocked(readKanbanSelectedProviderId);

describe("getSelectedProviderSettings (F1.30 local-only enforcement)", () => {
	it("resolves a local provider selection to its settings", () => {
		mockedRead.mockReturnValue("lmstudio");
		expect(getSelectedProviderSettings()).toEqual({ provider: "lmstudio" });
	});

	it("FAILS CLOSED (null) for a managed-cloud selection — the prime-directive filter", () => {
		mockedRead.mockReturnValue("nklein");
		expect(getSelectedProviderSettings()).toBeNull();
	});

	it("returns null when no provider is selected", () => {
		mockedRead.mockReturnValue(null);
		expect(getSelectedProviderSettings()).toBeNull();
	});
});

describe("toProviderServiceErrorMessage", () => {
	it("formats an Error and falls back for a non-error value", () => {
		expect(toProviderServiceErrorMessage(new Error("boom"))).toContain("boom");
		expect(toProviderServiceErrorMessage(undefined)).toBe("An unexpected error occurred.");
	});
});
