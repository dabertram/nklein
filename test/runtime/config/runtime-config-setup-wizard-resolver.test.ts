import { describe, expect, it } from "vitest";

import {
	DEFAULT_PROJECT_SETUP_WIZARD_COMPLETED_AT,
	DEFAULT_SETUP_WIZARD_COMPLETED_AT,
	normalizeSetupWizardCompletedAt,
	type RuntimeSetupWizardConfigFields,
	resolveRuntimeSetupWizardConfig,
} from "../../../src/config/runtime-config-setup-wizard-resolver";
import type {
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "../../../src/config/runtime-config-types";

const defaults: RuntimeSetupWizardConfigFields = {
	setupWizardCompletedAt: DEFAULT_SETUP_WIZARD_COMPLETED_AT,
	projectSetupWizardCompletedAt: DEFAULT_PROJECT_SETUP_WIZARD_COMPLETED_AT,
};

const globalConfig = (partial: Partial<RuntimeGlobalConfigFileShape>): RuntimeGlobalConfigFileShape =>
	partial as RuntimeGlobalConfigFileShape;
const projectConfig = (partial: Partial<RuntimeProjectConfigFileShape>): RuntimeProjectConfigFileShape =>
	partial as RuntimeProjectConfigFileShape;

describe("normalizeSetupWizardCompletedAt", () => {
	it("passes through a finite positive timestamp unchanged", () => {
		expect(normalizeSetupWizardCompletedAt(1_700_000_000_000)).toBe(1_700_000_000_000);
		expect(normalizeSetupWizardCompletedAt(1)).toBe(1);
	});

	it("resolves anything that is not a finite positive number to null (never run)", () => {
		for (const value of [
			0,
			-1,
			-1_700_000_000_000,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			"1700000000000",
			null,
			undefined,
			{},
			[],
			true,
		]) {
			expect(normalizeSetupWizardCompletedAt(value as unknown)).toBeNull();
		}
	});
});

describe("resolveRuntimeSetupWizardConfig", () => {
	it("defaults both stamps to null (never run) when configs are null → both wizards auto-fire", () => {
		expect(resolveRuntimeSetupWizardConfig(null, null)).toEqual(defaults);
		expect(DEFAULT_SETUP_WIZARD_COMPLETED_AT).toBeNull();
		expect(DEFAULT_PROJECT_SETUP_WIZARD_COMPLETED_AT).toBeNull();
	});

	it("reads a valid global stamp and leaves the project stamp null when no project is loaded", () => {
		expect(
			resolveRuntimeSetupWizardConfig(globalConfig({ setupWizardCompletedAt: 1_700_000_000_000 }), null),
		).toEqual({
			setupWizardCompletedAt: 1_700_000_000_000,
			projectSetupWizardCompletedAt: null,
		});
	});

	it("resolves the global + per-project stamps independently", () => {
		expect(
			resolveRuntimeSetupWizardConfig(
				globalConfig({ setupWizardCompletedAt: 1_700_000_000_000 }),
				projectConfig({ projectSetupWizardCompletedAt: 1_800_000_000_000 }),
			),
		).toEqual({
			setupWizardCompletedAt: 1_700_000_000_000,
			projectSetupWizardCompletedAt: 1_800_000_000_000,
		});
	});

	it("normalizes a garbage/zero/negative stored stamp back to null (auto-fire)", () => {
		expect(
			resolveRuntimeSetupWizardConfig(
				globalConfig({ setupWizardCompletedAt: 0 as unknown as number }),
				projectConfig({ projectSetupWizardCompletedAt: -5 as unknown as number }),
			),
		).toEqual(defaults);
	});
});
