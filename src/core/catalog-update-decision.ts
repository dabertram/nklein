/**
 * §5.AB llmfit-catalog update DECISION — the pure decider behind "check GitHub for a newer catalog and SUGGEST an
 * update, opt-out allowed" (David 2026-07-07). Given the LOCAL catalog identity, the REMOTE identity (from a
 * user-initiated / opt-in fetch — invariant #1: never automatic background egress), and the user's update mode,
 * decide the ONE next action. Pure: the effectful caller performs the fetch and, on `auto`, the pull; this only
 * classifies. Identity is compared as an opaque revision token (commit sha / etag / version string) — whatever the
 * fetch surfaces — so the decider never assumes a version SCHEME.
 */

export type CatalogUpdateMode = "off" | "notify" | "auto";

export interface CatalogUpdateInput {
	/** off = never check/suggest; notify (DEFAULT) = suggest, never pull; auto = pull without asking. */
	mode: CatalogUpdateMode;
	/** The local catalog's revision token (null when no local copy / unknown). */
	localRevision: string | null;
	/** The remote catalog's revision token from the fetch (null when the fetch failed / was skipped). */
	remoteRevision: string | null;
}

export type CatalogUpdateAction =
	/** Updates are disabled, or the fetch produced no remote revision — do nothing. */
	| { action: "noop"; reason: string }
	/** Local matches remote — already current. */
	| { action: "up_to_date"; reason: string }
	/** A newer remote exists and mode=notify — surface a suggestion, never pull. */
	| { action: "suggest_update"; remoteRevision: string; reason: string }
	/** A newer remote exists and mode=auto — the caller pulls it. */
	| { action: "pull_update"; remoteRevision: string; reason: string };

export function decideCatalogUpdate(input: CatalogUpdateInput): CatalogUpdateAction {
	if (input.mode === "off") {
		return { action: "noop", reason: "Catalog update checks are off." };
	}
	if (!input.remoteRevision) {
		return { action: "noop", reason: "No remote catalog revision available (fetch skipped or failed)." };
	}
	if (input.localRevision !== null && input.localRevision === input.remoteRevision) {
		return { action: "up_to_date", reason: `Local catalog is current at ${input.localRevision}.` };
	}
	// A differing (or absent) local revision means an update is available. `notify` suggests; `auto` pulls.
	const reason =
		input.localRevision === null
			? `A catalog is available (${input.remoteRevision}); no local copy yet.`
			: `A newer catalog is available (${input.remoteRevision}; local ${input.localRevision}).`;
	return input.mode === "auto"
		? { action: "pull_update", remoteRevision: input.remoteRevision, reason }
		: { action: "suggest_update", remoteRevision: input.remoteRevision, reason };
}
