import { decideEnforcedReasoning } from "../core/enforced-reasoning-gate";
import { runEnforcedReasoningLoop } from "../core/enforced-reasoning-loop";
import { isTruthyEnv } from "../core/env-flag";
import type { ModelBehaviorProfile } from "../core/model-behavior-profile";
import { estimateTaskDifficulty } from "../core/task-difficulty-estimate";
import {
	persistConsistencyAgreement,
	readCombinedModelBehaviorProfile,
} from "../telemetry/model-behavior-profile-store";

/**
 * §5.AD flag-gated adapter hookup — feeds real chat completions into the enforced-reasoning loop. OPT-IN via
 * NKLEIN_ENFORCED_REASONING (default OFF ⇒ the draft passes through byte-identical — this rides the hottest chat
 * path). When on: estimate the instruction's difficulty (the pure §5.AB estimator), consult the gate
 * (difficulty × struggle signal from the model's learned profile), and — only when it fires — run the loop's chosen
 * kind over the SAME completion the turn used. F3.13 (2026-07-18): cross-model carry is LIVE on this path — a
 * stronger loaded peer (resolved by the caller's `resolveStrongerPeer`, parameter-count-ranked) enables the
 * gate's carry kind and drives the peer completion; no peer ⇒ the pre-existing keep-draft degrade.
 */

export const ENFORCED_REASONING_FLAG = "NKLEIN_ENFORCED_REASONING";

export interface MaybeEnforceReasoningInput {
	/** The user's instruction this turn (difficulty + the loop's task framing). */
	task: string;
	/** The turn's final answer draft. */
	draft: string;
	/** The model's learned §5.AA profile (struggle signal), when known. */
	profile?: ModelBehaviorProfile | null;
	/** The drafting model id (trace/carry identity). */
	modelId?: string;
	/** The SAME-model completion the loop drives (system+user → text). */
	complete: (input: { system?: string; user: string }) => Promise<string>;
	/** F3.13: resolve a STRONGER loaded peer for cross-model carry (absent/null ⇒ carry never fires). */
	resolveStrongerPeer?: (draftModelId: string) => Promise<{
		modelId: string;
		complete: (input: { system?: string; user: string }) => Promise<string>;
	} | null>;
	/** Injected for tests; defaults to the process env flag. */
	enabled?: boolean;
}

/** Returns the (possibly bounced/revised) final answer; flag off / gate quiet / any failure ⇒ the draft unchanged. */
export async function maybeEnforceReasoning(input: MaybeEnforceReasoningInput): Promise<string> {
	const enabled = input.enabled ?? isTruthyEnv(process.env[ENFORCED_REASONING_FLAG]);
	if (!enabled || input.draft.trim().length === 0) {
		return input.draft;
	}
	try {
		// Struggle signal: an explicitly passed profile wins; otherwise resolve the model's learned profile from the
		// store best-effort (null on any failure ⇒ the gate stays conservative and does not fire).
		const profile =
			input.profile !== undefined
				? input.profile
				: input.modelId
					? await readCombinedModelBehaviorProfile(input.modelId).catch(() => null)
					: null;
		const difficulty = estimateTaskDifficulty({
			objectiveText: input.task,
			expectedFileCount: 0,
			bounceCount: 0,
			hasAcceptanceTests: /acceptance check:/i.test(input.task),
		});
		// Chat-surface calibration: the estimator's file/complexity factors are invisible here (a chat instruction has
		// no expectedFileCount), so the reachable score ceiling is ~0.65 (0.5·text + 0.15·acceptance). 0.30 on that
		// reduced range ≈ the default 0.6 on the full range: a substantive, test-backed ask fires; a question never does.
		// F3.13: a stronger LOADED peer enables cross_model_carry — the strongest external signal. Resolved
		// BEFORE the gate (availability shapes the kind); any failure ⇒ null ⇒ the gate composes without it.
		const strongerPeer =
			input.resolveStrongerPeer && input.modelId
				? await input.resolveStrongerPeer(input.modelId).catch(() => null)
				: null;
		const decision = decideEnforcedReasoning({
			difficulty: difficulty.score,
			difficultyThreshold: 0.3,
			...(profile ? { profile } : {}),
			...(strongerPeer ? { strongerPeerAvailable: true } : {}),
		});
		if (!decision.enforce) {
			return input.draft;
		}
		// LIVE-FOUND (2026-07-08, resident 9B): exact-match majority voting degenerates on FREE-FORM chat output —
		// two real samples never byte-match, so the naive draft survives as the first-seen "winner". Consistency
		// voting suits short determinate answers; chat drafts are generative, so map the gate's self_consistency to
		// the bounce kind here (the critique loop works on any output shape). The gate stays generic; the SURFACE
		// knows its output shape.
		const decisionForChat =
			decision.kind === "self_consistency" ? { ...decision, kind: "self_bounce_varied" as const } : decision;
		const result = await runEnforcedReasoningLoop({
			task: input.task,
			draft: input.draft,
			decision: decisionForChat,
			deps: {
				completeSelf: input.complete,
				...(strongerPeer ? { completeStronger: strongerPeer.complete } : {}),
			},
			...(input.modelId !== undefined ? { draftModelId: input.modelId } : {}),
		});
		// F3.15 record-only feed: when a consistency vote actually ran, persist its agreement rate into the
		// model's behavior stream (LOW agreement = stochastic output — a reliability/routing signal). Best-effort;
		// chat currently remaps consistency to the bounce kind, so today's producers are non-chat surfaces.
		if (result.consistencyAgreement !== undefined && input.modelId) {
			void persistConsistencyAgreement(input.modelId, result.consistencyAgreement).catch(() => undefined);
		}
		return result.finalDraft;
	} catch {
		return input.draft; // the bounce is an enhancement — never let it break the turn.
	}
}
