import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isLocalProvider } from "./nklein-local-only-policy";
import { readKanbanSelectedProviderId, writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import {
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	type SdkProviderSettings,
	saveSdkProviderSettings,
} from "./sdk-provider-boundary";

/**
 * Provider-selection self-heal (factory outage 2026-09-06). The selection file (`nklein-provider-selection.json`)
 * and `providers.json` vanished under a macOS temp-folder sweep while the runtime kept running; from then on every
 * start refused "No native !Klein provider is configured" — for nine hours, with a board full of ready work and the
 * model registry still naming the one local provider every session had ever used.
 *
 * A missing selection is recoverable whenever the runtime home still knows a LOCAL provider: the last-used entry of
 * `providers.json` first, else the most recently observed local provider in the model registry (with the endpoint
 * the sessions used). The heal rewrites the selection (and the settings when they are gone too) so the next read is
 * ordinary, and it records an observation — recovery must be visible, not silent. Cloud providers never qualify:
 * the local-only prime directive applies to healed selections exactly as it does to chosen ones.
 */

export type ProviderSelectionHealSource = "last_used_settings" | "model_registry";

export interface DerivedProviderSelection {
	providerId: string;
	baseUrl: string | null;
	modelId: string | null;
	source: ProviderSelectionHealSource;
}

export interface RegistryEntryLike {
	providerId: string;
	modelId: string;
	endpoint: string | null;
	updatedAt: number;
}

export interface DeriveProviderSelectionDeps {
	readLastUsedSettings: () => Pick<SdkProviderSettings, "provider" | "baseUrl" | "model"> | null;
	readRegistryEntries: () => readonly RegistryEntryLike[];
}

function safely<T>(read: () => T): T | null {
	try {
		return read();
	} catch {
		return null;
	}
}

/** Pure: which local provider the runtime home still evidences, or null when nothing local is known. */
export function deriveProviderSelection(deps: DeriveProviderSelectionDeps): DerivedProviderSelection | null {
	const lastUsed = safely(deps.readLastUsedSettings);
	const lastUsedId = lastUsed?.provider?.trim().toLowerCase() ?? "";
	if (lastUsedId && isLocalProvider(lastUsedId, lastUsed?.baseUrl ?? null)) {
		return {
			providerId: lastUsedId,
			baseUrl: lastUsed?.baseUrl?.trim() || null,
			modelId: lastUsed?.model?.trim() || null,
			source: "last_used_settings",
		};
	}
	const entries = (safely(deps.readRegistryEntries) ?? [])
		.filter((entry) => entry.providerId.trim().length > 0 && isLocalProvider(entry.providerId, entry.endpoint))
		.sort((left, right) => right.updatedAt - left.updatedAt);
	const newest = entries[0];
	if (!newest) {
		return null;
	}
	const providerId = newest.providerId.trim().toLowerCase();
	const endpoint =
		entries
			.find((entry) => entry.providerId.trim().toLowerCase() === providerId && entry.endpoint?.trim())
			?.endpoint?.trim() ?? null;
	return { providerId, baseUrl: endpoint, modelId: newest.modelId.trim() || null, source: "model_registry" };
}

function defaultRegistryPath(): string {
	return join(resolveNkleinRuntimeHomePath(homedir()), "model-registry.json");
}

/** The registry's entries reduced to what the heal needs; a missing/garbage file reads as no entries. */
export function readModelRegistryEntriesForHeal(registryPath: string = defaultRegistryPath()): RegistryEntryLike[] {
	try {
		const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as { models?: Record<string, unknown> };
		const models = parsed?.models;
		if (!models || typeof models !== "object") {
			return [];
		}
		const entries: RegistryEntryLike[] = [];
		for (const value of Object.values(models)) {
			if (!value || typeof value !== "object") {
				continue;
			}
			const entry = value as Partial<RegistryEntryLike>;
			if (typeof entry.providerId !== "string" || typeof entry.modelId !== "string") {
				continue;
			}
			entries.push({
				providerId: entry.providerId,
				modelId: entry.modelId,
				endpoint: typeof entry.endpoint === "string" ? entry.endpoint : null,
				updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
			});
		}
		return entries;
	} catch {
		return [];
	}
}

export interface HealMissingProviderSelectionResult {
	providerId: string;
	settings: SdkProviderSettings;
	source: ProviderSelectionHealSource;
}

/** A failed derivation is not retried on every read — the registry file is re-scanned at most once per minute. */
const HEAL_RETRY_MIN_GAP_MS = 60_000;
let lastFailedHealAt = 0;

/** @internal test seam */
export function resetProviderSelectionHealForTests(): void {
	lastFailedHealAt = 0;
}

/**
 * When no provider is selected, derive one from the runtime home's own evidence, persist it, and say so. Returns
 * null when a selection already exists or nothing local can be derived.
 */
export function healMissingProviderSelection(
	options: { warn?: (message: string) => void; now?: () => number } = {},
): HealMissingProviderSelectionResult | null {
	if (readKanbanSelectedProviderId()) {
		return null;
	}
	const now = options.now?.() ?? Date.now();
	if (lastFailedHealAt > 0 && now - lastFailedHealAt < HEAL_RETRY_MIN_GAP_MS) {
		return null;
	}
	const derived = deriveProviderSelection({
		readLastUsedSettings: () => getLastUsedSdkProviderSettings(),
		readRegistryEntries: () => readModelRegistryEntriesForHeal(),
	});
	if (!derived) {
		lastFailedHealAt = now;
		return null;
	}
	lastFailedHealAt = 0;
	writeKanbanSelectedProviderId(derived.providerId);
	let settings = safely(() => getSdkProviderSettings(derived.providerId));
	let settingsRewritten = false;
	if (!settings) {
		settings = {
			provider: derived.providerId,
			...(derived.baseUrl ? { baseUrl: derived.baseUrl } : {}),
			...(derived.modelId ? { model: derived.modelId } : {}),
		};
		settingsRewritten =
			safely(() => {
				saveSdkProviderSettings({
					settings: settings as SdkProviderSettings,
					tokenSource: "manual",
					setLastUsed: true,
				});
				return true;
			}) === true;
	}
	const message =
		`Provider selection restored from ${derived.source === "last_used_settings" ? "the last-used provider settings" : "the model registry"}: ` +
		`"${derived.providerId}"${derived.baseUrl ? ` at ${derived.baseUrl}` : ""}${settingsRewritten ? " (provider settings rewritten too)" : ""}. ` +
		"The selection file was missing — a temp-folder sweep or a wiped runtime home; check where the runtime home lives.";
	options.warn?.(message);
	recordSelfObservation({
		signal: "custom",
		severity: "warning",
		message,
		providerId: derived.providerId,
		modelId: derived.modelId,
		metadata: {
			category: "provider_selection_restored",
			source: derived.source,
			baseUrl: derived.baseUrl,
			settingsRewritten,
		},
	});
	return { providerId: derived.providerId, settings, source: derived.source };
}
