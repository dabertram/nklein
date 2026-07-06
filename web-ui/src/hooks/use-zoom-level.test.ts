import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_LEVEL, readStoredZoom, ZOOM_LEVELS } from "@/hooks/use-zoom-level";
import { LocalStorageKey } from "@/storage/local-storage-store";

describe("readStoredZoom (§5.BB five-level ladder)", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("defaults to Overview (1) with nothing stored — the decided new-user entry", () => {
		expect(readStoredZoom()).toBe(1);
		expect(DEFAULT_ZOOM_LEVEL).toBe(1);
	});

	it("reads a stored v2 value verbatim (0 = chat-only)", () => {
		window.localStorage.setItem(LocalStorageKey.UiZoomLevelV2, "0");
		expect(readStoredZoom()).toBe(0);
		window.localStorage.setItem(LocalStorageKey.UiZoomLevelV2, "4");
		expect(readStoredZoom()).toBe(4);
	});

	it("migrates a v1 value by +1 (chat-only inserted at 0) and persists the migration", () => {
		// Old scale: 0 overview · 1 lean · 2 expert · 3 professional.
		window.localStorage.setItem(LocalStorageKey.UiZoomLevel, "0");
		expect(readStoredZoom()).toBe(1); // overview stays overview
		expect(window.localStorage.getItem(LocalStorageKey.UiZoomLevelV2)).toBe("1");

		window.localStorage.clear();
		window.localStorage.setItem(LocalStorageKey.UiZoomLevel, "3");
		expect(readStoredZoom()).toBe(4); // professional stays professional
	});

	it("v2 wins over a stale v1 value once written", () => {
		window.localStorage.setItem(LocalStorageKey.UiZoomLevel, "3");
		window.localStorage.setItem(LocalStorageKey.UiZoomLevelV2, "0");
		expect(readStoredZoom()).toBe(0);
	});

	it("falls back to the default on garbage", () => {
		window.localStorage.setItem(LocalStorageKey.UiZoomLevelV2, "banana");
		window.localStorage.setItem(LocalStorageKey.UiZoomLevel, "7");
		expect(readStoredZoom()).toBe(DEFAULT_ZOOM_LEVEL);
	});

	it("the ladder is the five decided levels in order", () => {
		expect(ZOOM_LEVELS.map((entry) => entry.label)).toEqual(["Chat", "Overview", "Lean", "Expert", "Professional"]);
	});
});
