import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => ({
	getSdkProviderSettings: vi.fn(() => null),
	getLastUsedSdkProviderSettings: vi.fn(() => null),
	saveSdkProviderSettings: vi.fn(),
}));
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: vi.fn(),
}));

import { getSelectedProviderSettings } from "../../../src/nklein-agent/nklein-provider-selected-settings";
import {
	deriveProviderSelection,
	healMissingProviderSelection,
	readModelRegistryEntriesForHeal,
	resetProviderSelectionHealForTests,
} from "../../../src/nklein-agent/nklein-provider-selection-heal";
import { readKanbanSelectedProviderId } from "../../../src/nklein-agent/nklein-provider-selection-store";
import {
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	saveSdkProviderSettings,
} from "../../../src/nklein-agent/sdk-provider-boundary";
import { recordSelfObservation } from "../../../src/telemetry/self-observation-sink";

const SELECTION_ENV = "KANBAN_NKLEIN_PROVIDER_SELECTION_PATH";
const savedHome = process.env.HOME;
const savedSelectionEnv = process.env[SELECTION_ENV];
let tempHome: string;
let selectionPath: string;

function writeRegistry(models: Record<string, unknown>): void {
	const dir = join(tempHome, ".nklein", "nklein");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "model-registry.json"), JSON.stringify({ schemaVersion: 1, updatedAt: 1, models }));
}

beforeEach(() => {
	tempHome = mkdtempSync(join(tmpdir(), "nklein-heal-"));
	process.env.HOME = tempHome;
	selectionPath = join(tempHome, ".nklein", "nklein", "nklein-provider-selection.json");
	process.env[SELECTION_ENV] = selectionPath;
	resetProviderSelectionHealForTests();
	vi.mocked(getSdkProviderSettings).mockReturnValue(null);
	vi.mocked(getLastUsedSdkProviderSettings).mockReturnValue(null);
	vi.mocked(saveSdkProviderSettings).mockClear();
	vi.mocked(recordSelfObservation).mockClear();
});

afterEach(() => {
	process.env.HOME = savedHome;
	if (savedSelectionEnv === undefined) {
		delete process.env[SELECTION_ENV];
	} else {
		process.env[SELECTION_ENV] = savedSelectionEnv;
	}
	rmSync(tempHome, { recursive: true, force: true });
});

describe("deriveProviderSelection (2026-09-06 temp-folder sweep)", () => {
	it("prefers the last-used LOCAL provider settings", () => {
		expect(
			deriveProviderSelection({
				readLastUsedSettings: () => ({ provider: "LMStudio", baseUrl: "http://localhost:8081/v1", model: "dirk" }),
				readRegistryEntries: () => [{ providerId: "ollama", modelId: "x", endpoint: null, updatedAt: 5 }],
			}),
		).toEqual({
			providerId: "lmstudio",
			baseUrl: "http://localhost:8081/v1",
			modelId: "dirk",
			source: "last_used_settings",
		});
	});

	it("skips a cloud last-used provider and falls back to the newest local registry entry with its endpoint", () => {
		expect(
			deriveProviderSelection({
				readLastUsedSettings: () => ({ provider: "anthropic", model: "claude" }),
				readRegistryEntries: () => [
					{ providerId: "lmstudio", modelId: "old-model", endpoint: "http://localhost:1234/v1", updatedAt: 10 },
					{ providerId: "lmstudio", modelId: "dirk-qwen3.8-27b", endpoint: null, updatedAt: 50 },
					{ providerId: "lmstudio", modelId: "flash", endpoint: "http://localhost:8081/v1", updatedAt: 40 },
				],
			}),
		).toEqual({
			providerId: "lmstudio",
			baseUrl: "http://localhost:8081/v1",
			modelId: "dirk-qwen3.8-27b",
			source: "model_registry",
		});
	});

	it("returns null when neither source knows a local provider (readers may even throw)", () => {
		expect(
			deriveProviderSelection({
				readLastUsedSettings: () => {
					throw new Error("boom");
				},
				readRegistryEntries: () => [
					{ providerId: "openai", modelId: "gpt", endpoint: "https://api.openai.com/v1", updatedAt: 9 },
				],
			}),
		).toBeNull();
	});
});

describe("readModelRegistryEntriesForHeal", () => {
	it("reduces the registry file to heal entries and tolerates garbage", () => {
		writeRegistry({
			"lmstudio:dirk:http://localhost:8081/v1": {
				providerId: "lmstudio",
				modelId: "dirk",
				endpoint: "http://localhost:8081/v1",
				updatedAt: 7,
			},
			junk: 42,
			partial: { providerId: "lmstudio" },
		});
		expect(readModelRegistryEntriesForHeal()).toEqual([
			{ providerId: "lmstudio", modelId: "dirk", endpoint: "http://localhost:8081/v1", updatedAt: 7 },
		]);
		expect(readModelRegistryEntriesForHeal(join(tempHome, "missing.json"))).toEqual([]);
	});
});

describe("healMissingProviderSelection", () => {
	it("re-derives the selection from the registry, rewrites both files, and records the recovery", () => {
		writeRegistry({
			"lmstudio:dirk:http://localhost:8081/v1": {
				providerId: "lmstudio",
				modelId: "dirk-qwen3.8-27b",
				endpoint: "http://localhost:8081/v1",
				updatedAt: 7,
			},
		});
		const warn = vi.fn();
		const healed = healMissingProviderSelection({ warn });
		expect(healed?.providerId).toBe("lmstudio");
		expect(healed?.source).toBe("model_registry");
		expect(healed?.settings).toEqual({
			provider: "lmstudio",
			baseUrl: "http://localhost:8081/v1",
			model: "dirk-qwen3.8-27b",
		});
		expect(JSON.parse(readFileSync(selectionPath, "utf8"))).toEqual({ providerId: "lmstudio" });
		expect(readKanbanSelectedProviderId()).toBe("lmstudio");
		expect(saveSdkProviderSettings).toHaveBeenCalledWith({
			settings: { provider: "lmstudio", baseUrl: "http://localhost:8081/v1", model: "dirk-qwen3.8-27b" },
			tokenSource: "manual",
			setLastUsed: true,
		});
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0]?.[0]).toContain("Provider selection restored from the model registry");
		expect(recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				severity: "warning",
				providerId: "lmstudio",
				metadata: expect.objectContaining({ category: "provider_selection_restored", source: "model_registry" }),
			}),
		);
		// A second call sees the restored selection and does nothing.
		expect(healMissingProviderSelection({ warn })).toBeNull();
		expect(saveSdkProviderSettings).toHaveBeenCalledTimes(1);
	});

	it("keeps existing provider settings when only the selection file is gone", () => {
		vi.mocked(getLastUsedSdkProviderSettings).mockReturnValue({
			provider: "lmstudio",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		vi.mocked(getSdkProviderSettings).mockReturnValue({ provider: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1" });
		const healed = healMissingProviderSelection({ warn: () => undefined });
		expect(healed?.source).toBe("last_used_settings");
		expect(healed?.settings).toEqual({ provider: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1" });
		expect(saveSdkProviderSettings).not.toHaveBeenCalled();
		expect(readKanbanSelectedProviderId()).toBe("lmstudio");
	});

	it("returns null (no writes, no observation) when nothing local can be derived, and backs off re-scans", () => {
		let clock = 1_000;
		const now = () => clock;
		expect(healMissingProviderSelection({ warn: () => undefined, now })).toBeNull();
		writeRegistry({
			k: { providerId: "lmstudio", modelId: "dirk", endpoint: "http://localhost:8081/v1", updatedAt: 1 },
		});
		// Within the minute the failed derivation is not retried, even though evidence appeared.
		clock += 30_000;
		expect(healMissingProviderSelection({ warn: () => undefined, now })).toBeNull();
		clock += 31_000;
		expect(healMissingProviderSelection({ warn: () => undefined, now })?.providerId).toBe("lmstudio");
		expect(recordSelfObservation).toHaveBeenCalledTimes(1);
	});

	it("is what getSelectedProviderSettings falls back to — the start path no longer refuses", () => {
		writeRegistry({
			k: { providerId: "lmstudio", modelId: "dirk", endpoint: "http://localhost:8081/v1", updatedAt: 1 },
		});
		expect(getSelectedProviderSettings()).toEqual({
			provider: "lmstudio",
			baseUrl: "http://localhost:8081/v1",
			model: "dirk",
		});
	});

	it("never heals to a cloud provider — the local-only directive applies to recovery too", () => {
		vi.mocked(getLastUsedSdkProviderSettings).mockReturnValue({ provider: "anthropic" });
		writeRegistry({
			k: { providerId: "openai", modelId: "gpt", endpoint: "https://api.openai.com/v1", updatedAt: 1 },
		});
		expect(healMissingProviderSelection({ warn: () => undefined })).toBeNull();
		expect(getSelectedProviderSettings()).toBeNull();
	});
});
