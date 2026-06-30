import type { RuntimeConfigState } from "../../config/runtime-config";
import { fetchLoadedModelDescriptors, type LoadedModelDescriptor } from "../../core/lmstudio-loaded-model-descriptors";
import { lookupModelCapability, type ToolUseVerdict } from "../../core/model-capability-catalog";
import { affinityTagsForCapabilities, affinityTagsForModelKind } from "../../core/model-task-affinity";
import { buildLoadedModelRoutingCandidates, type LoadedModelRoutingProfile } from "../nklein-loaded-model-candidates";
import { getDefaultNKleinModelRegistry } from "../nklein-model-registry";
import { createNKleinProviderService } from "../nklein-provider-service";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { buildNKleinStartGuardCandidate } from "../nklein-task-start-guard";

/**
 * Map the §5.AL catalog's tool-use verdict to a 0–100 cold-start capability prior, so a freshly-LOADED model the ledger
 * has never observed is still ranked by what its model card implies (a tool-native coder/agentic model outranks a
 * tool-weak chat model) instead of the flat registry default. Null when the model isn't catalogued — the builder then
 * leaves the default in place. This is the FAST, pure, always-available prior; llmfit's richer score layers on top.
 */
const CATALOG_VERDICT_PRIOR: Record<ToolUseVerdict, number | null> = {
	TOOL_NATIVE: 80,
	TOOL_CAPABLE: 62,
	TOOL_WEAK: 28,
	TOOL_UNSUITABLE: 6,
	// UNKNOWN carries no signal → no override, fall back to the registry default rather than inventing a number.
	UNKNOWN: null,
};
function catalogCapabilityPrior(modelId: string): number | null {
	const entry = lookupModelCapability(modelId);
	return entry ? CATALOG_VERDICT_PRIOR[entry.toolUse] : null;
}

/** A coder model by name (matched on the REAL model key, e.g. `qwen2.5-coder`, `qwopus…-coder`, `devstral`). */
const CODER_NAME_PATTERN = /cod(?:e|er|ing)|devstral/i;
/** An opus-trained custom reasoner by name (user, 2026-07-01: "qwopus" = qwen + opus long-reasoning training). The API
 * card omits a `reasoning` flag for such local merges, so the name is the only runtime signal that they're reasoners. */
const OPUS_REASONER_NAME_PATTERN = /opus/i;

/**
 * Resolve a LOADED model's routing profile keyed on its REAL name (the descriptor's `modelKey`, NOT the per-machine
 * runtime alias). Combines the two signals that reinforce each other: the runtime card facts from `/api/v1/models`
 * (`trained_for_tool_use`, a declared `reasoning` capability) and the static §5.AL catalog (kind + tool-use verdict).
 * The cold-start prior comes from the catalog; the affinity tags are the UNION of the API-fact tags and the catalog
 * kind tags — so e.g. a coder whose card says `trained_for_tool_use:false` still gets the `agentic` tag from the
 * catalog's `code` kind, and a custom opus merge the catalog mis-labels still gets `reasoning` from its name.
 */
function resolveLoadedModelProfile(descriptor: LoadedModelDescriptor): LoadedModelRoutingProfile {
	if (descriptor.isEmbedding) {
		return { isEmbedding: true };
	}
	const realName = descriptor.modelKey;
	const catalogKind = lookupModelCapability(realName)?.kind ?? null;
	const coder = CODER_NAME_PATTERN.test(realName);
	const reasoning =
		descriptor.reasoning === true ||
		catalogKind === "reasoning" ||
		(OPUS_REASONER_NAME_PATTERN.test(realName) && !coder);
	const affinityTags = [
		...new Set([
			...affinityTagsForCapabilities({ reasoning, coder, toolUse: descriptor.toolUse }),
			...affinityTagsForModelKind(catalogKind),
		]),
	];
	return {
		isEmbedding: false,
		capabilityPrior: catalogCapabilityPrior(realName),
		affinityTags,
	};
}

/**
 * Build the runnable model "routing candidates" a decomposition can choose from: the default NKlein provider (when one
 * is runnable), **every model currently LOADED on that endpoint** (§5.AB north-star — auto-selection with no manual
 * role→model config), plus any explicitly-configured per-role model. Used by BOTH the task CLI and the runtime
 * decompose-apply path (so it lives in the agent layer, not `commands/`). Roles/models that aren't currently runnable
 * are skipped, not fatal.
 */
export async function buildDecompositionRoutingCandidates(
	runtimeConfig: RuntimeConfigState,
): Promise<NKleinTaskRoutingCandidate[]> {
	const nkleinProviderService = createNKleinProviderService();
	const modelRegistry = await getDefaultNKleinModelRegistry()
		.getSnapshot()
		.catch(() => ({
			schemaVersion: 1 as const,
			updatedAt: 0,
			models: {},
		}));
	const candidates = new Map<string, NKleinTaskRoutingCandidate>();
	try {
		const launchConfig = await nkleinProviderService.resolveLaunchConfig({});
		const candidate = buildNKleinStartGuardCandidate({
			launchConfig,
			role: null,
			modelRegistry,
		});
		candidates.set(candidate.entry.key, {
			entry: candidate.entry,
			role: candidate.role,
		});
		// §5.AB north-star: auto-DISCOVER every model currently loaded on this endpoint as a candidate, so a card can be
		// routed to the best-fit model with NO manual role→model config. Best-effort + LM-Studio-only (a non-LM-Studio
		// endpoint yields []); reuses each model's observed registry entry so the ledger history drives ranking. The
		// configured default/role candidates already set take precedence (richer guard-built entries) — don't clobber them.
		if (launchConfig.baseUrl) {
			// Read the RICH `/api/v1/models` descriptors so each loaded model's REAL key (not the per-machine alias) drives
			// the catalog/affinity lookups, and the authoritative `type` drives the embedding filter. The candidate identity
			// stays the runtime alias (what's actually invoked). A profile is resolved once per loaded model up front.
			const descriptors = await fetchLoadedModelDescriptors(launchConfig.baseUrl);
			const profilesByRuntimeId = new Map(descriptors.map((d) => [d.runtimeId, resolveLoadedModelProfile(d)]));
			for (const loadedCandidate of buildLoadedModelRoutingCandidates({
				loadedModelIds: descriptors.map((d) => d.runtimeId),
				registryEntries: Object.values(modelRegistry.models),
				providerId: launchConfig.providerId,
				endpoint: launchConfig.baseUrl,
				now: Date.now(),
				// Cold-start prior (catalog, keyed on the real name) + best-fit affinity tags (runtime caps ∪ catalog), so a
				// never-observed loaded model is ranked by its card. llmfit's richer score can chain into the prior later.
				resolveProfile: (runtimeId) => profilesByRuntimeId.get(runtimeId) ?? null,
			})) {
				if (!candidates.has(loadedCandidate.entry.key)) {
					candidates.set(loadedCandidate.entry.key, loadedCandidate);
				}
			}
		}
	} catch {
		// A workspace without a runnable default NKlein provider can still decompose from explicit role models.
	}

	for (const [role, settings] of Object.entries(runtimeConfig.effectiveModelRoles)) {
		if (!settings.providerId && !settings.modelId) {
			continue;
		}
		try {
			const launchConfig = await nkleinProviderService.resolveLaunchConfig({
				providerIdOverride: settings.providerId ?? undefined,
				modelIdOverride: settings.modelId ?? undefined,
				reasoningEffortOverride: settings.reasoningEffort ?? null,
			});
			const candidate = buildNKleinStartGuardCandidate({
				launchConfig,
				role,
				modelRegistry,
			});
			candidates.set(candidate.entry.key, {
				entry: candidate.entry,
				role: candidate.role,
			});
		} catch {
			// Ignore roles that are configured but not currently runnable.
		}
	}

	return [...candidates.values()];
}
