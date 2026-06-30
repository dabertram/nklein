import {
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import { normalizeBoolean, normalizePositiveInteger } from "./runtime-config-normalizers";
import type { RuntimeConfigState, RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/** The review/decomposition policy fields of the resolved runtime config. */
export type RuntimeReviewConfigFields = Pick<
	RuntimeConfigState,
	| "decompositionAutoApplyEnabled"
	| "secondOpinionReviewEnabled"
	| "reviewMaxRounds"
	| "readyForReviewNotificationsEnabled"
>;

/**
 * Resolve the review + decomposition policy fields from a stored global config (auto-apply
 * decomposition, second-opinion review on/off + max rounds, ready-for-review notifications).
 * Extracted from the toRuntimeConfigState builder (§5.U) as a focused, independently tested
 * sub-resolver.
 */
export function resolveRuntimeReviewConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
): RuntimeReviewConfigFields {
	return {
		decompositionAutoApplyEnabled: normalizeBoolean(
			globalConfig?.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		secondOpinionReviewEnabled: normalizeBoolean(
			globalConfig?.secondOpinionReviewEnabled,
			DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
		),
		reviewMaxRounds: normalizePositiveInteger(globalConfig?.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			globalConfig?.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
	};
}
