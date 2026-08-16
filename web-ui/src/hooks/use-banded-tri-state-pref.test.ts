// §5.BB S4: level-scoped (banded) board prefs — the contract that kills the "Professional collapses into
// Advanced" defect: toggles only bind within their band, and an explicit pre-banding value seeds the pro
// band exactly once.

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type BoardPrefBand, useBandedTriStatePref } from "@/hooks/use-banded-tri-state-pref";
import { LocalStorageKey } from "@/storage/local-storage-store";

const STANDARD = LocalStorageKey.BoardDependencyEdgesVisible;
const PRO = LocalStorageKey.BoardDependencyEdgesVisiblePro;

type Probe = {
	value: boolean;
	toggle: () => void;
	setBand: (band: BoardPrefBand) => void;
};

function Harness({ initialBand, probe }: { initialBand: BoardPrefBand; probe: Probe }): null {
	const [band, setBand] = useState<BoardPrefBand>(initialBand);
	const { value, toggle } = useBandedTriStatePref({ standardKey: STANDARD, proKey: PRO, band });
	probe.value = value;
	probe.toggle = toggle;
	probe.setBand = setBand;
	return null;
}

describe("useBandedTriStatePref", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		window.localStorage.clear();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	function mount(initialBand: BoardPrefBand): Probe {
		const probe: Probe = { value: false, toggle: () => {}, setBand: () => {} };
		act(() => root.render(createElement(Harness, { initialBand, probe })));
		return probe;
	}

	it("defers to the band default when unset: standard off, pro on", () => {
		const probe = mount("standard");
		expect(probe.value).toBe(false);
		act(() => probe.setBand("pro"));
		expect(probe.value).toBe(true);
	});

	it("scopes toggles to the active band — Advanced cannot collapse the Professional cockpit", () => {
		const probe = mount("pro");
		act(() => probe.toggle()); // explicitly close in the pro band
		expect(probe.value).toBe(false);
		act(() => probe.setBand("standard"));
		expect(probe.value).toBe(false); // standard band untouched: its own default (off)
		act(() => probe.toggle()); // open at standard
		expect(probe.value).toBe(true);
		act(() => probe.setBand("pro"));
		expect(probe.value).toBe(false); // pro remembers ITS explicit choice
		expect(window.localStorage.getItem(STANDARD)).toBe("1");
		expect(window.localStorage.getItem(PRO)).toBe("0");
	});

	it("seeds the pro band ONCE from an explicit pre-banding value, then splits", () => {
		window.localStorage.setItem(STANDARD, "1"); // legacy explicit ON (pre-banding user choice)
		const probe = mount("pro");
		expect(probe.value).toBe(true); // seeded from legacy
		expect(window.localStorage.getItem(PRO)).toBe("1"); // materialized, not a live alias
		act(() => probe.setBand("standard"));
		act(() => probe.toggle()); // later standard change...
		expect(window.localStorage.getItem(STANDARD)).toBe("0");
		act(() => probe.setBand("pro"));
		expect(probe.value).toBe(true); // ...never leaks into pro again
	});
});
