import type { RuntimeTaskAutoReviewMode, RuntimeTaskImage, RuntimeTaskNKleinSettings } from "./api-contract";

/**
 * Pure task-field normalizers/cloners extracted from task-board-mutations. They defensively copy
 * caller-owned values and drop empty/blank fields before a task is stored on the board, so the board
 * never retains external references. Behavior-preserving relative to their inline definitions.
 *
 * NOTE: `commands/task/task-nklein-settings.ts` has a separate `cloneTaskNKleinSettings` with a
 * slightly different signature (no `null`); consolidating them is a §4A verify-before-merge follow-up.
 */

/** Coerce the auto-review mode to a valid value, defaulting anything but `"pr"` to `"commit"`. */
export function normalizeTaskAutoReviewMode(
	value: RuntimeTaskAutoReviewMode | null | undefined,
): RuntimeTaskAutoReviewMode {
	if (value === "pr") {
		return value;
	}
	return "commit";
}

/** Copy image metadata so board tasks do not retain caller-owned array or object references. */
export function cloneTaskImages(images?: RuntimeTaskImage[]): RuntimeTaskImage[] | undefined {
	return images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined;
}

/** Clone NKlein settings, keeping only the non-empty fields (blank provider/model ids are dropped). */
export function cloneTaskNKleinSettings(
	settings?: RuntimeTaskNKleinSettings | null,
): RuntimeTaskNKleinSettings | undefined {
	if (settings === undefined || settings === null) {
		return undefined;
	}
	const providerId = settings.providerId?.trim();
	const modelId = settings.modelId?.trim();
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
		...(settings.contextScope ? { contextScope: settings.contextScope } : {}),
		...(settings.timeoutMode ? { timeoutMode: settings.timeoutMode } : {}),
		...(settings.requestTimeoutMs !== undefined ? { requestTimeoutMs: settings.requestTimeoutMs } : {}),
		...(settings.streamTimeoutMs !== undefined ? { streamTimeoutMs: settings.streamTimeoutMs } : {}),
		...(settings.toolTimeoutMs !== undefined ? { toolTimeoutMs: settings.toolTimeoutMs } : {}),
		...(settings.agentTimeoutMs !== undefined ? { agentTimeoutMs: settings.agentTimeoutMs } : {}),
		...(settings.conversationTimeoutMs !== undefined
			? { conversationTimeoutMs: settings.conversationTimeoutMs }
			: {}),
	};
}

/** De-duplicate, trim, and drop blank entries from a likely-touched file list; empty → undefined. */
export function normalizeFilesLikelyTouched(files?: string[]): string[] | undefined {
	if (!files || files.length === 0) {
		return undefined;
	}
	const normalized = Array.from(new Set(files.map((path) => path.trim()).filter((path) => path.length > 0)));
	return normalized.length > 0 ? normalized : undefined;
}
