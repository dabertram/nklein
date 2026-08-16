// §5.BB — the ZOOM LEVEL state: one continuous surface, five levels (David 2026-08-16 redesign:
// 0 Minimalistic · 1 Clean · 2 Advanced · 3 Professional · 4 Full). Persisted per user; the level gates
// VISIBILITY only, never capability. "Easy first": Minimalistic (the pure conversation) is the default for
// new users; Clean is the elegant map view whose cluster-click drills into the lean stream grid WITHIN the
// level (the former separate Lean level merged in); Full is the very fullest detail, absorbing the developer
// surfaces (server config remains the hard gate).

import { useCallback, useState } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export type ZoomLevel = 0 | 1 | 2 | 3 | 4;

export const ZOOM_LEVELS: readonly { level: ZoomLevel; label: string; short: string }[] = [
	{ level: 0, label: "Minimalistic", short: "0" },
	{ level: 1, label: "Clean", short: "1" },
	{ level: 2, label: "Advanced", short: "2" },
	{ level: 3, label: "Professional", short: "3" },
	{ level: 4, label: "Full", short: "4" },
];

/** The default entry for users with no stored preference: Minimalistic — easy first (David 2026-08-16). */
export const DEFAULT_ZOOM_LEVEL: ZoomLevel = 0;

function isZoomLevel(value: number): value is ZoomLevel {
	return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/** v2 ladder (0 chat · 1 overview · 2 lean · 3 expert · 4 professional) → v3: lean merges into Clean. */
function migrateV2(value: number): ZoomLevel | null {
	switch (value) {
		case 0:
			return 0;
		case 1:
		case 2:
			return 1;
		case 3:
			return 2;
		case 4:
			return 3;
		default:
			return null;
	}
}

/**
 * Read the persisted level. v3 wins verbatim; a v2 value migrates through {@link migrateV2}; the ancient v1
 * four-level scale first shifts +1 onto the v2 scale (chat-only inserted at 0), then migrates. The migrated
 * value is written back to v3 so later reads are direct.
 */
export function readStoredZoom(): ZoomLevel {
	const rawV3 = readLocalStorageItem(LocalStorageKey.UiZoomLevelV3);
	const parsedV3 = rawV3 === null ? Number.NaN : Number(rawV3);
	if (isZoomLevel(parsedV3)) {
		return parsedV3;
	}
	const rawV2 = readLocalStorageItem(LocalStorageKey.UiZoomLevelV2);
	const parsedV2 = rawV2 === null ? Number.NaN : Number(rawV2);
	const fromV2 = migrateV2(parsedV2);
	if (fromV2 !== null) {
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV3, String(fromV2));
		return fromV2;
	}
	const rawV1 = readLocalStorageItem(LocalStorageKey.UiZoomLevel);
	const parsedV1 = rawV1 === null ? Number.NaN : Number(rawV1);
	if (parsedV1 === 0 || parsedV1 === 1 || parsedV1 === 2 || parsedV1 === 3) {
		const fromV1 = migrateV2(parsedV1 + 1);
		if (fromV1 !== null) {
			writeLocalStorageItem(LocalStorageKey.UiZoomLevelV3, String(fromV1));
			return fromV1;
		}
	}
	return DEFAULT_ZOOM_LEVEL;
}

export function useZoomLevel(): {
	zoom: ZoomLevel;
	setZoom: (zoom: ZoomLevel) => void;
	/** Clean's stream drill (set by clicking a cluster on the activity map); null = the map itself. */
	streamFilter: string | null;
	/** Drill into the lean stream grid INSIDE Clean (the map's click-a-cluster motion). */
	zoomToStream: (clusterId: string) => void;
	/** Back out of the stream drill to the map (Clean's breadcrumb). */
	clearStreamFilter: () => void;
} {
	const [zoom, setZoomState] = useState<ZoomLevel>(readStoredZoom);
	const [streamFilter, setStreamFilter] = useState<string | null>(null);

	const setZoom = useCallback((next: ZoomLevel) => {
		setZoomState(next);
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV3, String(next));
		if (next !== 1) {
			setStreamFilter(null); // the drill belongs to Clean only
		}
	}, []);

	const zoomToStream = useCallback((clusterId: string) => {
		setStreamFilter(clusterId);
		setZoomState(1);
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV3, "1");
	}, []);

	const clearStreamFilter = useCallback(() => setStreamFilter(null), []);

	return { zoom, setZoom, streamFilter, zoomToStream, clearStreamFilter };
}
