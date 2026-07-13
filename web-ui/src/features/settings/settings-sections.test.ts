import { describe, expect, it } from "vitest";
import {
	initSettingsDraftFromConfig,
	type SettingsConfigSnapshot,
	type SettingsDraft,
	snapshotSwarmGuardrailInputs,
} from "@/features/settings/settings-draft";
import {
	dirtySections,
	isSectionDirty,
	resetSection,
	SETTINGS_SECTION_FIELDS,
	SETTINGS_SECTION_IDS,
} from "@/features/settings/settings-sections";

/**
 * F1.29 — the per-section draft boundary: complete + disjoint field coverage (locked), per-section dirty
 * detection agreeing with the whole-draft rules, and section-scoped reset that keeps other sections' edits.
 */

function snapshot(): SettingsConfigSnapshot {
	return initSettingsDraftFromConfig(null, { cloudProviderSupportEnabled: false });
}

function draftFrom(base: SettingsConfigSnapshot): SettingsDraft {
	const { swarmGuardrails: _structured, ...common } = base;
	return { ...common, swarmGuardrailInputs: snapshotSwarmGuardrailInputs(base) };
}

describe("SETTINGS_SECTION_FIELDS", () => {
	it("covers EVERY SettingsDraft field exactly once (complete + disjoint)", () => {
		const assigned = new Map<string, string>();
		for (const section of SETTINGS_SECTION_IDS) {
			for (const field of SETTINGS_SECTION_FIELDS[section]) {
				expect(assigned.has(field), `${field} assigned to both ${assigned.get(field)} and ${section}`).toBe(false);
				assigned.set(field, section);
			}
		}
		const draftKeys = Object.keys(draftFrom(snapshot()));
		for (const key of draftKeys) {
			expect(assigned.has(key), `draft field "${key}" belongs to no section`).toBe(true);
		}
		expect(assigned.size).toBe(draftKeys.length); // no section names a field the draft doesn't have
	});
});

describe("per-section dirty + reset", () => {
	it("a single edit dirties ONLY its section, and resetting that section restores cleanliness", () => {
		const base = snapshot();
		const clean = draftFrom(base);
		expect(dirtySections(clean, base)).toEqual([]);

		const edited: SettingsDraft = {
			...clean,
			requestTimeoutMs: "  9000  ",
			maxConcurrentTasks: clean.maxConcurrentTasks,
		};
		expect(isSectionDirty("timeouts", edited, base)).toBe(true);
		expect(isSectionDirty("concurrency", edited, base)).toBe(false);
		expect(dirtySections(edited, base)).toEqual(["timeouts"]);

		// Trim rule: whitespace-only differences on numeric-string inputs are NOT dirty.
		const trimmed: SettingsDraft = { ...clean, requestTimeoutMs: `${clean.requestTimeoutMs}  ` };
		expect(isSectionDirty("timeouts", trimmed, base)).toBe(false);

		const reset = resetSection("timeouts", edited, base);
		expect(dirtySections(reset, base)).toEqual([]);
	});

	it("resetting one section keeps another section's edits intact", () => {
		const base = snapshot();
		const edited: SettingsDraft = {
			...draftFrom(base),
			requestTimeoutMs: "9000", // timeouts
			developerModeEnabled: !base.developerModeEnabled, // features
		};
		expect(dirtySections(edited, base)).toEqual(["timeouts", "features"]);
		const reset = resetSection("timeouts", edited, base);
		expect(dirtySections(reset, base)).toEqual(["features"]); // features edit survives
		expect(reset.developerModeEnabled).toBe(!base.developerModeEnabled);
	});

	it("structured fields (model roles / guardrail inputs) compare deeply and reset through the snapshot", () => {
		const base = snapshot();
		const edited: SettingsDraft = {
			...draftFrom(base),
			modelRoles: { ...draftFrom(base).modelRoles, architect: { providerId: "lmstudio", modelId: "x" } } as never,
		};
		expect(isSectionDirty("models", edited, base)).toBe(true);
		const reset = resetSection("models", edited, base);
		expect(isSectionDirty("models", reset, base)).toBe(false);
	});
});
