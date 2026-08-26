import { totalmem } from "node:os";
import { resolveDeviceRamBytes } from "../../core/device-load-routing";
import {
	buildModelAcquisitionPreview,
	type ModelAcquisitionPreview,
	type ModelAcquisitionPreviewRequest,
} from "../../core/model-acquisition-preview";
import { parseModelAttributes } from "../../core/model-attributes";

/**
 * P25.3 phase-3 — the read-only setup acquisition PREVIEW handler. Resolves this host's memory budget (the one
 * fact the client cannot know) and renders the shared preview builder. NO download capability is imported here,
 * so wiring this onto the runtime router does not breach the acquisition boundary — the download stays the
 * consent-gated CLI handoff.
 */

/** Resolve the host budget with the loader's own precedence: env/Settings device map, else total physical RAM. */
export function resolvePreviewBudgetBytes(configuredDeviceRamGb: string | null): { bytes: number; source: string } {
	const map = resolveDeviceRamBytes({ configuredDeviceRamGb });
	const values = Object.values(map);
	if (values.length > 0) {
		// The local host is typically the largest declared device; size against it.
		return { bytes: Math.max(...values), source: "declared device RAM (NKLEIN_DEVICE_RAM_GB / Settings)" };
	}
	return {
		bytes: totalmem(),
		source: "total physical RAM (declare device RAM in Settings for an accurate, headroom-aware budget)",
	};
}

export function handlePreviewModelAcquisition(
	input: ModelAcquisitionPreviewRequest,
	deps: { configuredDeviceRamGb: string | null },
): ModelAcquisitionPreview {
	const budget = resolvePreviewBudgetBytes(deps.configuredDeviceRamGb);
	// Fall back to the key's parsed parameter count when the caller did not declare one — never guessed further.
	const paramB = input.paramB ?? parseModelAttributes(input.modelKey).paramB ?? null;
	return buildModelAcquisitionPreview({
		modelKey: input.modelKey,
		format: input.format,
		sizeBytes: input.sizeBytes,
		publisher: input.publisher,
		allowedPublishers: input.allowedPublishers,
		paramB,
		weightBitsPerParam: input.weightBitsPerParam,
		contextTokens: input.contextTokens,
		budgetBytes: budget.bytes,
		budgetSource: budget.source,
	});
}
