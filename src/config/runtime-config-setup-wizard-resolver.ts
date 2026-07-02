import type {
	RuntimeConfigState,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";

/**
 * §5.BA guided-configuration completion stamps — the wizards read these to decide whether to auto-fire.
 *
 * `setupWizardCompletedAt` (global) and `projectSetupWizardCompletedAt` (per-project) both default to `null`
 * = "never run". A `null` stamp is what makes the corresponding wizard auto-fire (global on first start,
 * project on first load of that project); a finite positive epoch-millis timestamp records that the wizard
 * has completed (or been dismissed with defaults). The trigger wiring that consumes these lands with the UI.
 */

/** Global setup wizard: never run by default (null) → the global wizard auto-fires on first start. */
export const DEFAULT_SETUP_WIZARD_COMPLETED_AT: number | null = null;
/** Per-project setup wizard: never run by default (null) → the project wizard auto-fires on first load. */
export const DEFAULT_PROJECT_SETUP_WIZARD_COMPLETED_AT: number | null = null;

/**
 * Completion-stamp normalizer: a finite positive number (epoch millis) passes through, anything else → null.
 * Mirrors the per-project scalar-override normalizers (e.g. `normalizeMaxConcurrentTasksOverride`): garbage,
 * zero, negatives, non-finite, and non-numbers all resolve to "never run" (null) rather than a bogus stamp.
 */
export function normalizeSetupWizardCompletedAt(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return value;
}

/** The §5.BA setup-wizard completion-stamp fields of the resolved runtime config (global + per-project). */
export type RuntimeSetupWizardConfigFields = Pick<
	RuntimeConfigState,
	"setupWizardCompletedAt" | "projectSetupWizardCompletedAt"
>;

/**
 * Resolve the setup-wizard completion stamps from the stored global + project configs. Mirrors the other
 * focused sub-resolvers so the big config-state assembly reads as a set of independently-tested blocks. The
 * global stamp lives in the global config; the per-project stamp lives in the project config and falls back
 * to null when no project is loaded (so a fresh project auto-fires its wizard).
 */
export function resolveRuntimeSetupWizardConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
	projectConfig: RuntimeProjectConfigFileShape | null,
): RuntimeSetupWizardConfigFields {
	return {
		setupWizardCompletedAt: normalizeSetupWizardCompletedAt(globalConfig?.setupWizardCompletedAt),
		projectSetupWizardCompletedAt: normalizeSetupWizardCompletedAt(projectConfig?.projectSetupWizardCompletedAt),
	};
}
