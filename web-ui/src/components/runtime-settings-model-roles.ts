import type { RuntimeModelRoles, RuntimeTaskNKleinSettings } from "@/runtime/types";

/**
 * Model-role settings helpers for the Settings dialog (§5.X #2 / settings-dialog sections), extracted from the
 * oversized `runtime-settings-dialog.tsx`. The three roles (architect / worker / reviewer), their labels, and the
 * normalize/serialize logic are shared between the `ModelRolesEditor` panel and the dialog's dirty/save path, so they
 * live here as the single source of truth. Pure, self-contained: no React/state.
 */

export const MODEL_ROLE_IDS = ["architect", "worker", "reviewer"] as const;
export type ModelRoleId = (typeof MODEL_ROLE_IDS)[number];
export const MODEL_ROLE_LABELS: Record<ModelRoleId, string> = {
	architect: "Architect",
	worker: "Worker",
	reviewer: "Reviewer",
};

function normalizeModelRoleTaskSettings(settings: RuntimeTaskNKleinSettings | undefined): RuntimeTaskNKleinSettings {
	const providerId = settings?.providerId?.trim();
	const modelId = settings?.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings?.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

function normalizeModelRoleSettings(settings: RuntimeModelRoles[string] | undefined): RuntimeModelRoles[string] {
	const primarySettings = normalizeModelRoleTaskSettings(settings);
	const additionalModels = (settings?.additionalModels ?? [])
		.map((entry) => normalizeModelRoleTaskSettings(entry))
		.filter((entry) => entry.providerId || entry.modelId);
	return {
		...primarySettings,
		...(additionalModels.length > 0 ? { additionalModels } : {}),
		...(settings?.modelSelectionMode === "pinned" && (primarySettings.providerId || primarySettings.modelId)
			? { modelSelectionMode: "pinned" as const }
			: {}),
		...(settings?.modelClassCap ? { modelClassCap: settings.modelClassCap } : {}),
		...(settings?.speedVsCapability && settings.speedVsCapability !== "capability"
			? { speedVsCapability: settings.speedVsCapability }
			: {}),
	};
}

export function normalizeModelRolesForSettings(modelRoles: RuntimeModelRoles | undefined): RuntimeModelRoles {
	const normalized: RuntimeModelRoles = {};
	for (const roleId of MODEL_ROLE_IDS) {
		const settings = normalizeModelRoleSettings(modelRoles?.[roleId]);
		if (Object.keys(settings).length > 0) {
			normalized[roleId] = settings;
		}
	}
	return normalized;
}

export function serializeModelRoles(modelRoles: RuntimeModelRoles | undefined): string {
	return JSON.stringify(normalizeModelRolesForSettings(modelRoles));
}
