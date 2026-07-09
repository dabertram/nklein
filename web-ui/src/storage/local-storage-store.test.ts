import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageKey, migrateLegacyLocalStorageKeys, readLocalStorageItem } from "@/storage/local-storage-store";

function toLegacyKey(currentKey: string): string {
	return currentKey.replace(/^nklein\./, "kanban.");
}

describe("local-storage-store", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("migrates every legacy kanban.* key to nklein.* once", () => {
		// Only keys that PREDATE the rebrand have a kanban.* twin — keys born after it (e.g. the setup-wizard
		// skip marker) have nothing to migrate, so seeding a fake twin for them would assert a phantom migration.
		const postRebrandKeys = new Set<string>([LocalStorageKey.SetupWizardSkipped]);
		const migratedKeys = Object.values(LocalStorageKey).filter(
			(key) => key.startsWith("nklein.") && !postRebrandKeys.has(key),
		);
		for (const key of migratedKeys) {
			window.localStorage.setItem(toLegacyKey(key), `${key}-value`);
		}

		migrateLegacyLocalStorageKeys();
		migrateLegacyLocalStorageKeys();

		for (const key of migratedKeys) {
			expect(window.localStorage.getItem(key)).toBe(`${key}-value`);
			expect(window.localStorage.getItem(toLegacyKey(key))).toBeNull();
		}
		expect(window.localStorage.getItem(LocalStorageKey.ProjectNavigationPanelWidth)).toBeNull();
		// A post-rebrand key is untouched by the migration (no phantom kanban.* source).
		expect(window.localStorage.getItem(LocalStorageKey.SetupWizardSkipped)).toBeNull();
	});

	it("reads a legacy key through the fallback path and rewrites it to the new key", () => {
		window.localStorage.setItem("kanban.theme", "graphite");

		expect(readLocalStorageItem(LocalStorageKey.Theme)).toBe("graphite");
		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBe("graphite");
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();
	});
});
