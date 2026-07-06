// §5.BB — the ZOOM LEVEL state: one continuous surface, five zooms (0 chat · 1 overview · 2 lean ·
// 3 expert · 4 professional). Persisted per user; zoom gates VISIBILITY only, never capability.
// Zoom 0 is the pure conversation (the "five-year-old" entry — board/map fully hidden); zoom 1
// (overview: chat + activity map) is the DEFAULT for new users (both user-decided 2026-07-06).

import { useCallback, useState } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export type ZoomLevel = 0 | 1 | 2 | 3 | 4;

export const ZOOM_LEVELS: readonly { level: ZoomLevel; label: string; short: string }[] = [
	{ level: 0, label: "Chat", short: "Z0" },
	{ level: 1, label: "Overview", short: "Z1" },
	{ level: 2, label: "Lean", short: "Z2" },
	{ level: 3, label: "Expert", short: "Z3" },
	{ level: 4, label: "Professional", short: "Z4" },
];

/** The default entry for users with no stored preference: Overview (chat + activity map). */
export const DEFAULT_ZOOM_LEVEL: ZoomLevel = 1;

function isZoomLevel(value: number): value is ZoomLevel {
	return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

/**
 * Read the persisted zoom. The v1 key stored the FOUR-level scale (0 overview … 3 professional); with chat-only
 * inserted at 0 every v1 value shifts up by one — migrate on first read (v2 wins once written).
 */
export function readStoredZoom(): ZoomLevel {
	const rawV2 = readLocalStorageItem(LocalStorageKey.UiZoomLevelV2);
	const parsedV2 = rawV2 === null ? Number.NaN : Number(rawV2);
	if (isZoomLevel(parsedV2)) {
		return parsedV2;
	}
	const rawV1 = readLocalStorageItem(LocalStorageKey.UiZoomLevel);
	const parsedV1 = rawV1 === null ? Number.NaN : Number(rawV1);
	if (parsedV1 === 0 || parsedV1 === 1 || parsedV1 === 2 || parsedV1 === 3) {
		const migrated = (parsedV1 + 1) as ZoomLevel;
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV2, String(migrated));
		return migrated;
	}
	return DEFAULT_ZOOM_LEVEL;
}

export function useZoomLevel(): {
	zoom: ZoomLevel;
	setZoom: (zoom: ZoomLevel) => void;
	/** The lean view's stream filter (set by clicking a cluster on the activity map); null = whole board. */
	streamFilter: string | null;
	/** Zoom into the lean board filtered to one stream (the map's click-a-cluster motion). */
	zoomToStream: (clusterId: string) => void;
	clearStreamFilter: () => void;
} {
	const [zoom, setZoomState] = useState<ZoomLevel>(readStoredZoom);
	const [streamFilter, setStreamFilter] = useState<string | null>(null);

	const setZoom = useCallback((next: ZoomLevel) => {
		setZoomState(next);
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV2, String(next));
		if (next !== 2) {
			setStreamFilter(null); // the filter belongs to the lean view only
		}
	}, []);

	const zoomToStream = useCallback((clusterId: string) => {
		setStreamFilter(clusterId);
		setZoomState(2);
		writeLocalStorageItem(LocalStorageKey.UiZoomLevelV2, "2");
	}, []);

	const clearStreamFilter = useCallback(() => setStreamFilter(null), []);

	return { zoom, setZoom, streamFilter, zoomToStream, clearStreamFilter };
}
