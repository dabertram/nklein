/**
 * `nklein dev card-timeline <cardId>` — everything that happened to one card, in one ordered timeline.
 *
 * DISTINCT FROM `dev card-trail` (F12.55), which renders a plain-language, artifact-anchored ACTION trail from
 * the ledger for a person deciding what a card did. This is the FORENSIC view: every source merged, verbatim
 * metadata, no prose smoothing, and explicit source-availability so a gap is distinguishable from silence. The
 * two answer different questions and neither replaces the other.
 *
 * ⚠️ Found by collision, not by search: `dev capability-index` indexes `src/core` ONLY, so a command that
 * already existed was invisible to the duplication check. See P15.6 — the index needs command coverage.
 *
 * Reads every per-card source that already exists rather than introducing a new store: self-observations, the
 * agent ledger, the runtime log, and the board's current lane. A parallel store would be a second source of
 * truth that drifts; a source that is merely UNREAD can be added later without any emission site changing.
 *
 * ── WHY EVERY SOURCE REPORTS ITS OWN AVAILABILITY ──
 * "This source had no events for the card" and "this source could not be read" are different facts, and only one
 * of them means the trail is trustworthy. Collapsing them makes a deleted log look like a quiet card, which is
 * the failure that would make this tool actively misleading rather than merely incomplete.
 */

import { findTrailGaps, renderCardTrail } from "../core/card-lifecycle-trail";
import { gatherCardTrail } from "../state/card-trail-sources";

export async function runDevCardTimelineCommand(
	cardId: string,
	options: { home?: string; json?: boolean; gapMs?: string },
): Promise<void> {
	const home = options.home;
	if (!home) {
		process.stdout.write(
			"usage: dev card-timeline <cardId> --home <path>\n" +
				"  <path> is the isolated HOME a nightly cell retained on failure (the failure report prints it).\n",
		);
		process.exitCode = 2;
		return;
	}

	const trail = await gatherCardTrail({ home, cardId });

	if (options.json) {
		process.stdout.write(`${JSON.stringify(trail, null, 2)}\n`);
		return;
	}

	process.stdout.write(`${renderCardTrail(trail)}\n`);

	const gaps = findTrailGaps(trail, Number.parseInt(options.gapMs ?? "60000", 10));
	if (gaps.length > 0) {
		process.stdout.write(`\nQUIET PERIODS (where to look first):\n`);
		for (const gap of gaps.slice(0, 5)) {
			process.stdout.write(`  ${Math.round(gap.gapMs / 1000)}s of silence after "${gap.afterKind}"\n`);
		}
		process.stdout.write(
			"  A gap is not a verdict — it is normal on a dependency-blocked card and pathological on a running one.\n",
		);
	}
}
