import { describe, expect, it } from "vitest";
import {
	initSettingsDraftFromConfig,
	type SettingsConfigSnapshot,
	type SettingsDraft,
	snapshotSwarmGuardrailInputs,
} from "@/features/settings/settings-draft";
import {
	dirtyNavSections,
	dirtySections,
	isNavSectionDirty,
	isSectionDirty,
	resetNavSection,
	resetSection,
	SETTINGS_NAV_FIELDS,
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

describe("SETTINGS_NAV_FIELDS — the nav-aligned axis (F1.29b)", () => {
	it("every covered nav tab names only real draft fields, with no field claimed by two tabs", () => {
		const draftKeys = new Set(Object.keys(draftFrom(snapshot())));
		const assigned = new Map<string, string>();
		for (const [nav, fields] of Object.entries(SETTINGS_NAV_FIELDS)) {
			for (const field of fields ?? []) {
				expect(draftKeys.has(field), `nav "${nav}" names non-draft field "${field}"`).toBe(true);
				expect(assigned.has(field), `${field} claimed by both ${assigned.get(field)} and ${nav}`).toBe(false);
				assigned.set(field, nav);
			}
		}
	});

	it("a per-tab edit dirties ONLY that tab, and per-tab reset restores it without touching other tabs", () => {
		const base = snapshot();
		const clean = draftFrom(base);
		expect(dirtyNavSections(clean, base)).toEqual([]);

		const edited: SettingsDraft = {
			...clean,
			developerModeEnabled: !base.developerModeEnabled, // rendered under the General tab
			readyForReviewNotificationsEnabled: !base.readyForReviewNotificationsEnabled, // under the Notifications tab
		};
		expect(isNavSectionDirty("general", edited, base)).toBe(true);
		expect(isNavSectionDirty("notifications", edited, base)).toBe(true);
		expect(dirtyNavSections(edited, base).sort()).toEqual(["general", "notifications"]);

		const reset = resetNavSection("general", edited, base);
		expect(isNavSectionDirty("general", reset, base)).toBe(false);
		// The Notifications edit survives a General-only reset.
		expect(isNavSectionDirty("notifications", reset, base)).toBe(true);
		expect(reset.readyForReviewNotificationsEnabled).toBe(!base.readyForReviewNotificationsEnabled);
	});

	it("a tab with no per-tab affordance is never dirty and resets to a no-op", () => {
		const base = snapshot();
		const edited: SettingsDraft = { ...draftFrom(base), requestTimeoutMs: "9000" };
		// "agents" is not in SETTINGS_NAV_FIELDS yet (multi-tab draft sections render there — a later leaf).
		expect(isNavSectionDirty("agents", edited, base)).toBe(false);
		expect(resetNavSection("agents", edited, base)).toEqual(edited);
	});
});
