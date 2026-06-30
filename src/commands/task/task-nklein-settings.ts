import {
	type RuntimeNKleinReasoningEffort,
	type RuntimeTaskNKleinSettings,
	runtimeNKleinReasoningEffortSchema,
} from "../../core/api-contract.js";
import { cloneTaskNKleinSettings } from "../../core/task-field-normalization.js";

/**
 * Pure helpers for the `nklein task` CLI's per-task NKlein settings (provider / model / reasoning effort / timeouts),
 * extracted from the oversized `task.ts` (todo §5.U). No I/O — just parsing the CLI's reasoning-effort flag and
 * building / cloning the `RuntimeTaskNKleinSettings` override that create/update send to the runtime. Kept separate so
 * `task.ts` stays a thin command registrar.
 */

/** A parsed `--reasoning-effort` value: a real effort, `"default"` (clear to provider default), `null` (inherit), or
 *  `undefined` (flag absent / leave unchanged). */
export type ParsedTaskNKleinReasoningEffort = RuntimeNKleinReasoningEffort | "default" | null | undefined;

export function parseTaskNKleinReasoningEffort(value: string | undefined): ParsedTaskNKleinReasoningEffort {
	if (value === undefined) {
		return undefined;
	}
	if (value === "inherit") {
		return null;
	}
	if (value === "default") {
		return "default";
	}
	const result = runtimeNKleinReasoningEffortSchema.safeParse(value);
	if (result.success) {
		return result.data;
	}
	throw new Error("Invalid !Klein reasoning effort. Expected one of: default, low, medium, high, xhigh, inherit.");
}

export function formatTaskNKleinSettings(settings?: RuntimeTaskNKleinSettings): Record<string, unknown> {
	if (settings === undefined) {
		return {};
	}
	return {
		nkleinSettings: cloneTaskNKleinSettings(settings) ?? {},
	};
}

export function buildTaskNKleinSettingsForCreate(input: {
	providerId?: string;
	modelId?: string;
	reasoningEffort?: ParsedTaskNKleinReasoningEffort;
}): RuntimeTaskNKleinSettings | undefined {
	const providerId = input.providerId?.trim();
	const modelId = input.modelId?.trim();
	const reasoningEffort = input.reasoningEffort === null ? undefined : input.reasoningEffort;
	if (!providerId && !modelId && reasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(reasoningEffort && reasoningEffort !== "default" ? { reasoningEffort } : {}),
	};
}

export function buildTaskNKleinSettingsForUpdate(
	currentSettings: RuntimeTaskNKleinSettings | undefined,
	input: {
		providerId?: string | null;
		modelId?: string | null;
		reasoningEffort?: ParsedTaskNKleinReasoningEffort;
	},
): RuntimeTaskNKleinSettings | null | undefined {
	if (input.providerId === undefined && input.modelId === undefined && input.reasoningEffort === undefined) {
		return undefined;
	}
	const nextSettings = cloneTaskNKleinSettings(currentSettings) ?? {};
	let preserveEmptyOverride = currentSettings !== undefined && Object.keys(currentSettings).length === 0;

	if (input.providerId !== undefined) {
		const providerId = input.providerId?.trim();
		if (providerId) {
			nextSettings.providerId = providerId;
		} else {
			delete nextSettings.providerId;
		}
	}

	if (input.modelId !== undefined) {
		const modelId = input.modelId?.trim();
		if (modelId) {
			nextSettings.modelId = modelId;
		} else {
			delete nextSettings.modelId;
		}
	}

	if (input.reasoningEffort !== undefined) {
		if (input.reasoningEffort === "default") {
			delete nextSettings.reasoningEffort;
			preserveEmptyOverride = true;
		} else if (input.reasoningEffort === null) {
			delete nextSettings.reasoningEffort;
			preserveEmptyOverride = false;
		} else {
			nextSettings.reasoningEffort = input.reasoningEffort;
		}
	}

	if (
		nextSettings.providerId === undefined &&
		nextSettings.modelId === undefined &&
		nextSettings.reasoningEffort === undefined &&
		!preserveEmptyOverride
	) {
		return null;
	}

	return nextSettings;
}
