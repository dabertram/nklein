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
		const migratedKeys = Object.values(LocalStorageKey).filter((key) => key.startsWith("nklein."));
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
	});

	it("reads a legacy key through the fallback path and rewrites it to the new key", () => {
		window.localStorage.setItem("kanban.theme", "graphite");

		expect(readLocalStorageItem(LocalStorageKey.Theme)).toBe("graphite");
		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBe("graphite");
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();
	});
});
