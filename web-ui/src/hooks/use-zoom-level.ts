// §5.BB — the ZOOM LEVEL state: one continuous surface, four zooms (0 overview · 1 lean · 2 expert ·
// 3 professional). Persisted per user; zoom gates VISIBILITY only, never capability. Zoom 0 is the
// chat-centric main entry (the user-approved direction).

import { useCallback, useState } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export type ZoomLevel = 0 | 1 | 2 | 3;

export const ZOOM_LEVELS: readonly { level: ZoomLevel; label: string; short: string }[] = [
	{ level: 0, label: "Overview", short: "Z0" },
	{ level: 1, label: "Lean", short: "Z1" },
	{ level: 2, label: "Expert", short: "Z2" },
	{ level: 3, label: "Professional", short: "Z3" },
];

function readStoredZoom(): ZoomLevel {
	const raw = readLocalStorageItem(LocalStorageKey.UiZoomLevel);
	const parsed = raw === null ? Number.NaN : Number(raw);
	return parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3 ? (parsed as ZoomLevel) : 0;
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
		writeLocalStorageItem(LocalStorageKey.UiZoomLevel, String(next));
		if (next !== 1) {
			setStreamFilter(null); // the filter belongs to the lean view only
		}
	}, []);

	const zoomToStream = useCallback((clusterId: string) => {
		setStreamFilter(clusterId);
		setZoomState(1);
		writeLocalStorageItem(LocalStorageKey.UiZoomLevel, "1");
	}, []);

	const clearStreamFilter = useCallback(() => setStreamFilter(null), []);

	return { zoom, setZoom, streamFilter, zoomToStream, clearStreamFilter };
}
