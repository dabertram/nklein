// §5.BB S4: LEVEL-SCOPED board preferences. The old single tri-state pref made one explicit toggle win at
// EVERY level, so closing the fleet strip at Advanced also un-pinned Professional's cockpit ("Professional
// collapses into Advanced", the redesign audit's headline defect). Preferences now live in two BANDS —
// `standard` (zoom ≤ 2) and `pro` (Professional/Full, zoom ≥ 3) — each with its own storage key and its own
// band default. The unsuffixed legacy key doubles as the standard band; on first use the pro band MATERIALIZES
// its seed from any explicit legacy value (one-time copy), after which the bands never influence each other.

import { useCallback, useState } from "react";

import { type LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export type BoardPrefBand = "standard" | "pro";

export function useBandedTriStatePref({
	standardKey,
	proKey,
	band,
}: {
	/** The legacy/unsuffixed key — it IS the standard band (zero migration for existing users). */
	standardKey: LocalStorageKey;
	/** The pro band's own key (Professional/Full). */
	proKey: LocalStorageKey;
	/** Which band is active — derives from the zoom level (pro at Professional/Full). */
	band: BoardPrefBand;
}): { value: boolean; toggle: () => void } {
	const [rawByBand, setRawByBand] = useState<Record<BoardPrefBand, string | null>>(() => {
		const standard = readLocalStorageItem(standardKey);
		let pro = readLocalStorageItem(proKey);
		if (pro === null && standard !== null) {
			// One-time seed: an explicit pre-banding choice carries into the pro band, then the bands split.
			writeLocalStorageItem(proKey, standard);
			pro = standard;
		}
		return { standard, pro };
	});

	const raw = rawByBand[band];
	// Unset defers to the band default: the pro band IS the cockpit (on), the standard band stays clean (off).
	const value = raw === null ? band === "pro" : raw === "1";

	const toggle = useCallback(() => {
		const next = value ? "0" : "1";
		writeLocalStorageItem(band === "pro" ? proKey : standardKey, next);
		setRawByBand((current) => ({ ...current, [band]: next }));
	}, [band, proKey, standardKey, value]);

	return { value, toggle };
}
