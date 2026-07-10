import { listDevTestProjectIds } from "../nklein-agent/dev-test-project-registry";
import type { DevTestSelection, NKleinDevTestProjectPreset } from "../nklein-agent/nklein-dev-test-project";

/** The dev-test presets a `dev test-sweep` run exercises when none are specified. */
const DEFAULT_DEV_TEST_SWEEP_PRESETS: readonly NKleinDevTestProjectPreset[] = [
	"wide_fanout",
	"deep_chain",
	"mixed_dag",
	"many_small",
];

/**
 * Parse a single `dev test-project --preset` value, extracted from the dev command. Defaults to
 * `"mid_task"` when omitted; throws on an unrecognized preset (CLI argument validation).
 */
export function parseDevTestPreset(value: string | undefined): DevTestSelection {
	if (value === undefined) {
		return "mid_task";
	}
	if (
		value === "mid_task" ||
		value === "complex_dag" ||
		value === "audio_vst" ||
		value === "daw_foundation" ||
		value === "wide_fanout" ||
		value === "deep_chain" ||
		value === "mixed_dag" ||
		value === "many_small"
	) {
		return value;
	}
	// Any dev-test-projects registry folder id is also a valid selection (the lower-20 scenario projects, todo §13f).
	if (listDevTestProjectIds().includes(value)) {
		return value;
	}
	throw new Error(
		"Invalid preset. Expected one of: mid_task, complex_dag, audio_vst, daw_foundation, wide_fanout, deep_chain, mixed_dag, many_small — or a dev-test-projects registry id (e.g. 01_clinical_medication_safety_platform).",
	);
}

/**
 * Parse a comma-separated `dev test-sweep --presets` value into the list of presets. Empty/blank
 * input yields the {@link DEFAULT_DEV_TEST_SWEEP_PRESETS}; otherwise each non-blank entry is
 * validated via {@link parseDevTestPreset} (so an invalid entry throws).
 */
export function parseDevTestSweepPresets(value: string | undefined): DevTestSelection[] {
	if (value === undefined || value.trim().length === 0) {
		return [...DEFAULT_DEV_TEST_SWEEP_PRESETS];
	}
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
		.map((entry) => parseDevTestPreset(entry));
}
