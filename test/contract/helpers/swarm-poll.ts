import { requestJson } from "./http";

/**
 * Early-exit board poller for the deterministic swarm harnesses (user 2026-07-02: "detect
 * stalls/failures/success earlier"). The old loops polled every 3s until the FULL deadline even when the
 * outcome was already decided — a parked card or a dead swarm burned the remaining minutes for nothing.
 *
 * Decision rules per poll (2s cadence):
 *  - "target"   — the scenario's success predicate holds (instant success, as before).
 *  - "parked"   — a card's review status is `parked` (opt-in): a parked card awaits a HUMAN, which a
 *                 deterministic scenario never provides ⇒ the outcome is decided; fail NOW.
 *  - "dead"     — NO session is alive (running/queued/starting/awaiting_review), NO card sits in the
 *                 review lane (host-side review/acceptance work runs between sessions there, e.g. the
 *                 acceptance exec can take minutes with zero live sessions), and the lanes have not
 *                 changed for `deadPolls` consecutive polls ⇒ nothing can ever make progress; fail NOW.
 *  - "deadline" — the budget ran out with the outcome still open (the old behavior, now the last resort).
 */

interface SwarmPollState {
	board?: {
		columns?: Array<{
			id?: string;
			cards?: Array<{ id?: string; review?: { status?: string } | null }>;
		}>;
	};
	sessions?: Record<string, { state?: string }>;
}

export interface SwarmPollResult {
	outcome: "target" | "parked" | "dead" | "deadline";
	lanes: Map<string, string>;
	/** Human-readable evidence for assertion messages (lanes + sessions + why we stopped). */
	detail: string;
}

const ALIVE_SESSION_STATES = new Set(["running", "queued", "starting", "awaiting_review"]);

export async function pollSwarmBoardUntil(input: {
	baseUrl: string;
	workspaceId: string;
	deadlineMs: number;
	isTarget: (lanes: Map<string, string>) => boolean;
	/** Treat a parked card as a decided failure (PASS-path scenarios). Default false. */
	failOnParked?: boolean;
	/** Consecutive unchanged-and-dead polls before declaring "dead". Default 5 (~10s). */
	deadPolls?: number;
	pollIntervalMs?: number;
}): Promise<SwarmPollResult> {
	const pollIntervalMs = input.pollIntervalMs ?? 2_000;
	const deadPollsNeeded = input.deadPolls ?? 5;
	let lanes = new Map<string, string>();
	let lastLaneFingerprint = "";
	let deadStreak = 0;
	let lastSessionsDetail = "";
	while (Date.now() < input.deadlineMs) {
		const stateRes = await requestJson<SwarmPollState>({
			baseUrl: input.baseUrl,
			procedure: "workspace.getState",
			type: "query",
			workspaceId: input.workspaceId,
		}).catch(() => null);
		if (stateRes) {
			lanes = new Map<string, string>();
			let parkedCardId: string | null = null;
			let anyCardInReviewLane = false;
			for (const column of stateRes.payload.board?.columns ?? []) {
				for (const card of column.cards ?? []) {
					if (card.id && column.id) {
						lanes.set(card.id, column.id);
						if (column.id === "review") {
							anyCardInReviewLane = true;
						}
						if (card.review?.status === "parked") {
							parkedCardId = card.id;
						}
					}
				}
			}
			const sessions = Object.entries(stateRes.payload.sessions ?? {});
			const anySessionAlive = sessions.some(([, session]) => ALIVE_SESSION_STATES.has(session.state ?? ""));
			lastSessionsDetail = sessions.map(([id, session]) => `${id}=${session.state ?? "?"}`).join(", ");
			const detail = `lanes: ${JSON.stringify([...lanes.entries()])} | sessions: ${lastSessionsDetail}`;

			if (input.isTarget(lanes)) {
				return { outcome: "target", lanes, detail };
			}
			if (input.failOnParked && parkedCardId) {
				return {
					outcome: "parked",
					lanes,
					detail: `card ${parkedCardId} is PARKED (awaits a human a deterministic run never provides) — outcome decided early. ${detail}`,
				};
			}
			const laneFingerprint = JSON.stringify([...lanes.entries()].sort());
			const frozen = laneFingerprint === lastLaneFingerprint;
			lastLaneFingerprint = laneFingerprint;
			if (frozen && !anySessionAlive && !anyCardInReviewLane && lanes.size > 0) {
				deadStreak += 1;
				if (deadStreak >= deadPollsNeeded) {
					return {
						outcome: "dead",
						lanes,
						detail: `swarm is DEAD-QUIESCENT (no live session, no review-lane work, lanes frozen ${deadStreak} polls) — outcome decided early. ${detail}`,
					};
				}
			} else {
				deadStreak = 0;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	return {
		outcome: "deadline",
		lanes,
		detail: `deadline reached with the outcome still open. lanes: ${JSON.stringify([...lanes.entries()])} | sessions: ${lastSessionsDetail}`,
	};
}
