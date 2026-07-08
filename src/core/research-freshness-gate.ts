import { classifyTopicVolatility } from "./knowledge-volatility-ttl";
import { type FreshnessVerdict, judgeRetrievedFreshness } from "./retrieval-freshness";

/**
 * §5.AC freshness gate for the decompose/research pass — the pure decision behind "if the knowledge is stale,
 * trigger online retrieval". Composes the existing cores (topic volatility → thresholds; freshness judgment over the
 * local knowledge's date) and adds ONLY the routing rule:
 *
 *  - no egress available ⇒ `use_local` always (invariant #1 posture: never demand the network);
 *  - local knowledge with NO date on a realtime/fast topic ⇒ `retrieve_online` (undated fast-moving knowledge is the
 *    risky case — an undated evergreen fact is fine to use);
 *  - dated local knowledge judged `stale`/`possibly_stale` at the topic's volatility thresholds ⇒ `retrieve_online`;
 *  - everything else ⇒ `use_local`.
 *
 * Pure + clock-injected; the decompose/research wiring effects the retrieval (the §5.AC loop) and surfaces the
 * verdict to the user.
 */

export interface ResearchFreshnessGateInput {
	/** The task/topic text — classifies volatility (fast-moving model news vs evergreen algorithm facts). */
	taskText: string;
	/** When the LOCAL knowledge being relied on was published/recorded; null/undefined ⇒ unknown age. */
	knowledgeAt?: Date | string | number | null;
	/** The authoritative "now" (§5.AC temporal context) — always injected, never Date.now() here. */
	now: Date;
	/** Whether online retrieval is even available (egress enabled + a search backend configured). */
	egressAvailable: boolean;
}

export interface ResearchFreshnessGateDecision {
	action: "retrieve_online" | "use_local";
	/** The freshness verdict over the local knowledge (drives the user-facing "is this current?" line). */
	verdict: FreshnessVerdict;
	/** One human-readable sentence for the agent output (the surfaced "is this current?" reasoning). */
	reason: string;
}

export function decideResearchFreshnessGate(input: ResearchFreshnessGateInput): ResearchFreshnessGateDecision {
	const volatility = classifyTopicVolatility(input.taskText);
	const judgment = judgeRetrievedFreshness({ publishedAt: input.knowledgeAt ?? null }, input.now, {
		thresholds: volatility.thresholds,
	});
	if (!input.egressAvailable) {
		return {
			action: "use_local",
			verdict: judgment.verdict,
			reason: `Online retrieval is unavailable — proceeding on local knowledge (${judgment.verdict}; topic volatility: ${volatility.volatility}).`,
		};
	}
	if (judgment.verdict === "unknown" && (volatility.volatility === "fast" || volatility.volatility === "realtime")) {
		return {
			action: "retrieve_online",
			verdict: judgment.verdict,
			reason: `Local knowledge has no date and the topic is fast-moving (${volatility.matchedSignals.join(", ") || "volatility signals"}) — verifying online first.`,
		};
	}
	if (judgment.verdict === "stale" || judgment.verdict === "possibly_stale") {
		return {
			action: "retrieve_online",
			verdict: judgment.verdict,
			reason: `Local knowledge is ${judgment.verdict.replace("_", " ")} at this topic's volatility (${volatility.volatility}, ttl ${volatility.ttlDays}d) — refreshing online first.`,
		};
	}
	return {
		action: "use_local",
		verdict: judgment.verdict,
		reason: `Local knowledge is ${judgment.verdict} for this topic's volatility (${volatility.volatility}) — no online refresh needed.`,
	};
}
