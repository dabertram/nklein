/**
 * Resolve a LOADED model's routing profile (§5.AB) — the cold-start capability prior + best-fit affinity tags + the
 * authoritative embedding flag — keyed on the model's REAL name (not the per-machine runtime alias). Shared by every
 * path that auto-discovers the loaded set as routing candidates (the decompose-apply path and the live task-start
 * path), so the "how do we judge a freshly-loaded model" logic lives in exactly one tested place.
 *
 * It fuses the two capability signals that reinforce each other:
 *   - RUNTIME card facts from LM Studio's native `/api/v1/models` ({@link LoadedModelDescriptor}) — empirical ground
 *     truth: `trained_for_tool_use`, a declared `reasoning` capability, and the real publisher key;
 *   - the static §5.AL catalog — its `kind` (code/reasoning/…) and tool-use verdict.
 *
 * The cold-start prior comes from the catalog (keyed on the real name); the affinity tags are the UNION of the API-fact
 * tags and the catalog-kind tags — so e.g. a coder whose card reports `trained_for_tool_use:false` still gets `agentic`
 * from the catalog's `code` kind, and a custom merge the catalog mislabels still gets `reasoning` from its name.
 */

import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { lookupModelCapability, type ToolUseVerdict } from "../core/model-capability-catalog";
import { affinityTagsForCapabilities, affinityTagsForModelKind } from "../core/model-task-affinity";
import type { LoadedModelRoutingProfile } from "./nklein-loaded-model-candidates";

/**
 * Map the §5.AL catalog's tool-use verdict to a 0–100 cold-start capability prior, so a freshly-LOADED model the ledger
 * has never observed is still ranked by what its model card implies (a tool-native coder/agentic model outranks a
 * tool-weak chat model) instead of the flat registry default. `UNKNOWN`/uncatalogued ⇒ null (no override, keep the
 * default). This is the FAST, always-available prior; llmfit's richer score can chain ahead of it later.
 */
const CATALOG_VERDICT_PRIOR: Record<ToolUseVerdict, number | null> = {
	TOOL_NATIVE: 80,
	TOOL_CAPABLE: 62,
	TOOL_WEAK: 28,
	TOOL_UNSUITABLE: 6,
	UNKNOWN: null,
};

/** The §5.AL catalog cold-start prior for a model (by REAL name), or null when uncatalogued / no signal. */
export function catalogCapabilityPrior(modelId: string): number | null {
	const entry = lookupModelCapability(modelId);
	return entry ? CATALOG_VERDICT_PRIOR[entry.toolUse] : null;
}

/** A coder model by name (matched on the REAL model key, e.g. `qwen2.5-coder`, `qwopus…-coder`, `devstral`). */
const CODER_NAME_PATTERN = /cod(?:e|er|ing)|devstral/i;
/** An opus-trained custom reasoner by name (user, 2026-07-01: "qwopus" = qwen + opus long-reasoning training). The API
 * card omits a `reasoning` flag for such local merges, so the name is the only runtime signal that they're reasoners. */
const OPUS_REASONER_NAME_PATTERN = /opus/i;

/**
 * Resolve a loaded model's {@link LoadedModelRoutingProfile} from its descriptor. Embeddings short-circuit (they are not
 * agentic routing candidates). For an LLM: prior from the catalog (real name), affinity = runtime caps ∪ catalog kind,
 * with an opus-name heuristic so a custom reasoner is tagged `reasoning` even when its card omits the flag.
 */
export function resolveLoadedModelProfile(descriptor: LoadedModelDescriptor): LoadedModelRoutingProfile {
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
