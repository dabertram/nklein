/**
 * N16 — EXTRACT an operator hold from a retained run's files. PURE core.
 *
 * `operator-hold-evidence.ts` assembles evidence once the facts are known. Getting the facts OUT of a retained
 * HOME is the other half, and it is where both real defects lived — so it is split out here to be testable
 * against the strings a real run actually produced, rather than living as an untested closure in the command.
 *
 * ── WHY THIS IS THE HALF THAT BREAKS ──
 * The assembly half is arithmetic over values a test can hand it. The extraction half is regexes over logs
 * written by other subsystems, and **when a regex reads the wrong source it does not throw — it returns a
 * confident, well-formed report with the two decisive fields quietly wrong.** Both 2026-07-20 defects had that
 * shape, and both survived the assembly half's fifteen passing tests:
 *
 *  1. **The reason code and branch ref live in the SELF-OBSERVATION telemetry, not `runtime.log`.** Reading the
 *     log alone produced `unknown` / no branch — a report that names neither the cause nor whether the work
 *     survived, while looking complete.
 *  2. **An UNSCOPED branch match returns whichever branch appears first in the blob.** On the real run that was
 *     `s00`'s branch for a hold on `s03`. **Pointing a reader at the wrong artefact is worse than reporting
 *     none:** they inspect intact work, conclude nothing was lost, and close the investigation.
 *
 * Both are regression-tested below against the real run's strings, because neither is recoverable by reasoning
 * about the code — only by having run it once and noticed.
 */

import { buildOperatorHoldEvidence, type OperatorHoldEvidence, type SurvivingArtefact } from "./operator-hold-evidence";

export interface RetainedRunSources {
	/** `runtime.log` from the retained HOME. Carries the HOLD line. */
	readonly runtimeLog: string;
	/** Self-observation telemetry. Carries the reason CODE and the result-branch ref. */
	readonly telemetryText: string;
	/** Raw `board.json`, or null when no board was readable. Null and "no edges" are different facts. */
	readonly boardJson: string | null;
	readonly cellId: string;
	readonly seed: string | null;
}

export interface ExtractedOperatorHold {
	readonly evidence: OperatorHoldEvidence;
	/**
	 * True when the board could not be read. The blocked-dependent count is then UNKNOWN, not zero — and zero is
	 * the reading that makes a stalled run look harmless.
	 */
	readonly dependentsUnknown: boolean;
	readonly note: string;
}

/** The hold line, which is the only part reliably present in `runtime.log`. */
const HOLD_PATTERN = /Task result capture (?:failed|has not settled) for ([^;]+); held in Review/;

/** The reason CODE line, emitted into self-observation telemetry. */
const REASON_PATTERN = /Could not capture sandbox task result patch[^"\n]*/;

function parseDependencyEdges(boardJson: string | null): { fromTaskId: string; toTaskId: string }[] | null {
	if (boardJson === null) {
		return null;
	}
	try {
		const parsed = JSON.parse(boardJson) as { dependencies?: { fromTaskId: string; toTaskId: string }[] };
		return parsed.dependencies ?? [];
	} catch {
		// A malformed board is "could not read", not "no dependencies". Returning [] here would report a stalled
		// subtree of 22 cards as zero blocked — the single most misleading number this report can produce.
		return null;
	}
}

/**
 * Find the result branch for THIS card.
 *
 * Scoped to `cardId` deliberately: the telemetry blob holds every card's branch, and an unscoped match returns
 * the first one written, which on the real run belonged to a different, healthy card.
 */
export function findResultBranchForCard(telemetryText: string, cardId: string): string | null {
	const escaped = cardId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const scoped = new RegExp(`Sandbox task result branch updated: ([^\\s"\\\\]*${escaped}[^\\s"\\\\]*)`);
	return scoped.exec(telemetryText)?.[1] ?? null;
}

/**
 * Extract an operator hold from a retained run, or null when the run did not hold a card.
 *
 * Pure: the caller reads the files, this reads the strings.
 */
export function extractOperatorHold(sources: RetainedRunSources): ExtractedOperatorHold | null {
	const held = HOLD_PATTERN.exec(sources.runtimeLog);
	if (!held?.[1]) {
		return null;
	}
	const cardId = held[1].trim();

	// Telemetry FIRST, log second, hold line last. The order is the fix for defect (1): the log is a fallback,
	// never the primary, and the hold line itself classifies as `unknown` — correct, since it names no cause.
	const holdMessage =
		REASON_PATTERN.exec(sources.telemetryText)?.[0] ?? REASON_PATTERN.exec(sources.runtimeLog)?.[0] ?? held[0];

	const edges = parseDependencyEdges(sources.boardJson);
	const branchRef = findResultBranchForCard(sources.telemetryText, cardId);
	const survivingArtefacts: SurvivingArtefact[] = branchRef
		? [
				{
					kind: "result_branch",
					ref: branchRef,
					detail:
						"branch present in the retained workspace — inspect with `git -C <home>/.nklein/dev-workspaces/* log`",
				},
			]
		: [];

	const evidence = buildOperatorHoldEvidence({
		cardId,
		holdMessage,
		dependencyEdges: edges ?? [],
		logLines: sources.runtimeLog.split("\n"),
		survivingArtefacts,
		seed: sources.seed,
		cellId: sources.cellId,
	});

	const dependentsUnknown = edges === null;
	return {
		evidence,
		dependentsUnknown,
		note: `\n  ${evidence.summary}${
			dependentsUnknown
				? "\n  (NOTE: no dependency edges were readable, so the blocked-dependent count is UNKNOWN rather than zero.)"
				: ""
		}`,
	};
}
