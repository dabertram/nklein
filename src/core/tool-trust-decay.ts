/**
 * F12.24 per-tool trust decay — PURE core.
 *
 * A small model that fails the SAME tool repeatedly in one session (malformed args, wrong idiom) keeps reaching for
 * it anyway — each failure burns a turn and re-teaches nothing. This tracker scores consecutive per-tool failures
 * within a session and answers, per tool, whether to DEMOTE it (move its schema to the catalog tail + attach a
 * usage hint) or DROP it for the rest of the session (the model provably cannot drive it; alternatives exist).
 * A success resets the tool's count — decay is about the current struggle, not history. Extends F3.30's retry
 * philosophy from turns to tools. Pure: caller owns the state and supplies every observation.
 */

export interface ToolTrustState {
	/** Consecutive FAILURES per tool (a success resets to 0). */
	readonly consecutiveFailures: Map<string, number>;
}

export function createToolTrustState(): ToolTrustState {
	return { consecutiveFailures: new Map() };
}

export type ToolTrustTier = "trusted" | "demoted" | "dropped";

export const DEMOTE_AT_CONSECUTIVE_FAILURES = 3;
export const DROP_AT_CONSECUTIVE_FAILURES = 5;

/** Record one tool outcome. Success resets the streak; failure increments it. Returns the tool's NEW tier. */
export function recordToolOutcome(state: ToolTrustState, toolName: string, succeeded: boolean): ToolTrustTier {
	if (succeeded) {
		state.consecutiveFailures.set(toolName, 0);
		return "trusted";
	}
	const failures = (state.consecutiveFailures.get(toolName) ?? 0) + 1;
	state.consecutiveFailures.set(toolName, failures);
	return tierForFailures(failures);
}

export function toolTrustTier(state: ToolTrustState, toolName: string): ToolTrustTier {
	return tierForFailures(state.consecutiveFailures.get(toolName) ?? 0);
}

function tierForFailures(failures: number): ToolTrustTier {
	if (failures >= DROP_AT_CONSECUTIVE_FAILURES) {
		return "dropped";
	}
	if (failures >= DEMOTE_AT_CONSECUTIVE_FAILURES) {
		return "demoted";
	}
	return "trusted";
}

/**
 * Guidance line for a demoted tool (attached beside its schema): names the streak and the likeliest fix, so the
 * next attempt is a corrected one rather than a repeat. Dropped tools get the removal explanation the model sees
 * once — with the alternative to reach for instead (caller supplies it; never strand the model tool-less).
 */
export function toolTrustGuidance(
	tier: ToolTrustTier,
	toolName: string,
	options: { alternative?: string | null } = {},
): string | null {
	if (tier === "demoted") {
		return `You have failed ${toolName} ${DEMOTE_AT_CONSECUTIVE_FAILURES}+ times in a row — re-read its schema and copy the argument shapes EXACTLY before trying again.`;
	}
	if (tier === "dropped") {
		return `${toolName} is disabled for the rest of this session after ${DROP_AT_CONSECUTIVE_FAILURES} consecutive failures${
			options.alternative ? ` — use ${options.alternative} instead` : ""
		}.`;
	}
	return null;
}

/**
 * Order an offered-tool list by trust: DROPPED tools are withheld (unless that would empty the offer — never
 * strand the model tool-less) and DEMOTED tools sink to the catalog tail (stable partition). Returns the input
 * array itself when nothing changes, so callers can cheaply detect the no-op.
 */
export function orderOfferedToolsByTrust<T extends { name: string }>(
	state: ToolTrustState,
	offered: readonly T[],
): readonly T[] {
	const kept = offered.filter((tool) => toolTrustTier(state, tool.name) !== "dropped");
	const usable = kept.length >= 1 ? kept : offered;
	const demoted = usable.filter((tool) => toolTrustTier(state, tool.name) === "demoted");
	const ordered =
		demoted.length > 0
			? [...usable.filter((tool) => toolTrustTier(state, tool.name) !== "demoted"), ...demoted]
			: usable;
	return ordered.length === offered.length && ordered.every((tool, index) => tool === offered[index])
		? offered
		: ordered;
}
