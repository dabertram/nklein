import { describe, expect, it } from "vitest";

import {
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "../../../src/config/runtime-config-defaults";
import { resolveRuntimeReviewConfig } from "../../../src/config/runtime-config-review-resolver";
import type { RuntimeGlobalConfigFileShape } from "../../../src/config/runtime-config-types";

const config = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;

describe("resolveRuntimeReviewConfig", () => {
	it("falls back to defaults for a null config", () => {
		expect(resolveRuntimeReviewConfig(null)).toEqual({
			decompositionAutoApplyEnabled: DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			secondOpinionReviewEnabled: DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
			reviewMaxRounds: DEFAULT_REVIEW_MAX_ROUNDS,
			readyForReviewNotificationsEnabled: DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		});
	});

	it("reads configured boolean + numeric values", () => {
		expect(
			resolveRuntimeReviewConfig(
				config({
					decompositionAutoApplyEnabled: !DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
					secondOpinionReviewEnabled: !DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
					reviewMaxRounds: 5,
					readyForReviewNotificationsEnabled: !DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
				}),
			),
		).toEqual({
			decompositionAutoApplyEnabled: !DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			secondOpinionReviewEnabled: !DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
			reviewMaxRounds: 5,
			readyForReviewNotificationsEnabled: !DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		});
	});

	it("falls back reviewMaxRounds to its default for a non-positive value", () => {
		expect(resolveRuntimeReviewConfig(config({ reviewMaxRounds: 0 })).reviewMaxRounds).toBe(
			DEFAULT_REVIEW_MAX_ROUNDS,
		);
	});
});
