/**
 * P20.10c — collect the 24h/7d churn windows without requiring a daemon to stay alive for seven days.
 *
 * Git already retains the snapshots we need. Once a deadline has elapsed, a caller resolves the latest historical
 * ref at or before that deadline which contains the accepted commit, then this core blames that exact snapshot.
 * This is more durable than timers: runtime restarts, sleeping laptops, and missed nightly ticks do not lose data.
 */

import { type AuthoredFile, type ChurnGitPort, type CollectedChurn, collectChurnForCard } from "./churn-collector";
import { assessChurn, type ChurnAssessment } from "./post-acceptance-churn";

export const CHURN_24H_MS = 24 * 60 * 60 * 1_000;
export const CHURN_7D_MS = 7 * CHURN_24H_MS;

export type ChurnWindowId = "24h" | "7d";

export interface ChurnWindowPlan {
	readonly id: ChurnWindowId;
	readonly dueAt: number;
	readonly state: "pending" | "due";
}

export interface WindowedChurnResult {
	readonly status: "pending" | "complete" | "unresolvable";
	readonly windows: readonly ChurnWindowPlan[];
	readonly sample24h: CollectedChurn | null;
	readonly sample7d: CollectedChurn | null;
	readonly ref24h: string | null;
	readonly ref7d: string | null;
	readonly assessment: ChurnAssessment | null;
	readonly reason: string;
}

export function planChurnWindows(acceptedAt: number, now: number): readonly ChurnWindowPlan[] {
	return [
		{ id: "24h", dueAt: acceptedAt + CHURN_24H_MS, state: now >= acceptedAt + CHURN_24H_MS ? "due" : "pending" },
		{ id: "7d", dueAt: acceptedAt + CHURN_7D_MS, state: now >= acceptedAt + CHURN_7D_MS ? "due" : "pending" },
	];
}

export interface ChurnWindowGitPort extends ChurnGitPort {
	/** Latest historical ref at/before `dueAt` which contains the accepted commit. */
	readonly resolveContainingRefAtOrBefore: (input: {
		readonly commit: string;
		readonly laterRef: string;
		readonly dueAt: number;
	}) => Promise<string | null>;
}

/** Resolve every elapsed window and feed genuine two-timepoint data into `assessChurn` once both exist. */
export async function collectWindowedChurn(input: {
	readonly cardId: string;
	readonly commit: string;
	readonly acceptedAt: number;
	readonly now: number;
	readonly laterRef: string;
	readonly files: readonly AuthoredFile[];
	readonly git: ChurnWindowGitPort;
}): Promise<WindowedChurnResult> {
	const windows = planChurnWindows(input.acceptedAt, input.now);
	const collect = async (window: ChurnWindowPlan): Promise<{ ref: string; sample: CollectedChurn } | null> => {
		if (window.state === "pending") return null;
		const ref = await input.git.resolveContainingRefAtOrBefore({
			commit: input.commit,
			laterRef: input.laterRef,
			dueAt: window.dueAt,
		});
		if (!ref) return null;
		return {
			ref,
			sample: await collectChurnForCard({
				cardId: input.cardId,
				commit: input.commit,
				laterRef: ref,
				files: input.files,
				git: input.git,
			}),
		};
	};
	const [window24, window7] = windows;
	if (!window24 || !window7) throw new Error("churn window plan is incomplete");
	const sample24 = await collect(window24);
	const sample7 = await collect(window7);
	const unresolvable =
		(window24.state === "due" && sample24 === null) || (window7.state === "due" && sample7 === null);
	if (unresolvable) {
		return {
			status: "unresolvable",
			windows,
			sample24h: sample24?.sample ?? null,
			sample7d: sample7?.sample ?? null,
			ref24h: sample24?.ref ?? null,
			ref7d: sample7?.ref ?? null,
			assessment: null,
			reason:
				"an elapsed churn window has no historical ref that both precedes its deadline and contains the accepted commit",
		};
	}
	if (!sample24 || !sample7) {
		const pending = windows.filter((window) => window.state === "pending").map((window) => window.id);
		return {
			status: "pending",
			windows,
			sample24h: sample24?.sample ?? null,
			sample7d: sample7?.sample ?? null,
			ref24h: sample24?.ref ?? null,
			ref7d: sample7?.ref ?? null,
			assessment: null,
			reason: `waiting for ${pending.join(" and ")} window(s); no rate is estimated from a deadline that has not elapsed`,
		};
	}
	const assessment = assessChurn({
		cardId: input.cardId,
		authoredLines: sample24.sample.authoredLines,
		churnedWithin24h: sample24.sample.churnedLines,
		churnedWithin7d: sample7.sample.churnedLines,
	});
	return {
		status: "complete",
		windows,
		sample24h: sample24.sample,
		sample7d: sample7.sample,
		ref24h: sample24.ref,
		ref7d: sample7.ref,
		assessment,
		reason: `measured at retained git snapshots for both elapsed windows (${sample24.ref.slice(0, 12)} and ${sample7.ref.slice(0, 12)})`,
	};
}
