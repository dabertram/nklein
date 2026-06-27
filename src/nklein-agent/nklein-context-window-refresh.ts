/**
 * Keep the model registry's context window in step with the LIVE loaded window of a local provider (bug fix, 2026-06-27).
 *
 * A local model (LM Studio / Ollama) is loaded at a chosen context length that is often SMALLER than the model's max
 * (e.g. a 131072-max model loaded at 40000). LM Studio's `/api/v0/models` reports both `loaded_context_length` (the real
 * allocated window) and `max_context_length`, and discovery already prefers the loaded one. But discovery never wrote that
 * value back into the registry — the registry only got context windows from the task-run path — so a stale/max value
 * (recorded when the model was previously loaded larger, or seeded from the max) would stick as `contextWindow.effective`
 * and be used for the context budget. Sending 131k of context to a 40k-loaded model risks a real overflow.
 *
 * This pure helper computes which existing registry entries are out of date relative to the freshly-discovered loaded
 * windows, so the caller can `recordContextWindow({ advertisedContextWindow })` them — the registry's "advertised changed
 * → clear the stale observed" rule then refreshes `effective` to the live loaded size (a user override still wins).
 */

/** A live-discovered provider model (only the fields this refresh needs). */
export interface DiscoveredModelWindow {
	id: string;
	contextWindow?: number | null;
}

/** An existing registry entry (only the fields this refresh needs). */
export interface RegistryEntryWindow {
	providerId: string;
	modelId: string;
	endpoint: string | null;
	contextWindow: { advertised: number | null };
}

/** A registry context-window refresh to apply via `recordContextWindow`. */
export interface ContextWindowRefresh {
	providerId: string;
	modelId: string;
	endpoint: string | null;
	contextWindow: number;
}

function toPositiveWindow(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.trunc(value);
}

/**
 * For each EXISTING registry entry of `providerId` whose model is currently loaded with a DIFFERENT context window than
 * its recorded `advertised`, emit a refresh carrying the live loaded window. Keys off the existing entries (matching by
 * model id) so the refresh updates the entry in place by its real provider/model/endpoint key — never creating a
 * duplicate — and only when the value actually changed, so a steady state produces no writes.
 */
export function selectLiveContextWindowRefreshes(input: {
	providerId: string;
	discoveredModels: readonly DiscoveredModelWindow[];
	registryEntries: readonly RegistryEntryWindow[];
}): ContextWindowRefresh[] {
	const provider = input.providerId.trim().toLowerCase();
	const loadedByModelId = new Map<string, number>();
	for (const model of input.discoveredModels) {
		const window = toPositiveWindow(model.contextWindow);
		if (window !== null) {
			loadedByModelId.set(model.id, window);
		}
	}

	const refreshes: ContextWindowRefresh[] = [];
	for (const entry of input.registryEntries) {
		if (entry.providerId.trim().toLowerCase() !== provider) {
			continue;
		}
		const loaded = loadedByModelId.get(entry.modelId);
		if (loaded === undefined || entry.contextWindow.advertised === loaded) {
			continue;
		}
		refreshes.push({
			providerId: entry.providerId,
			modelId: entry.modelId,
			endpoint: entry.endpoint,
			contextWindow: loaded,
		});
	}
	return refreshes;
}
