import { buildCrossModelBouncePrompt, parseCrossModelBounceReply } from "./cross-model-bounce";
import type { EnforcedReasoningDecision } from "./enforced-reasoning-gate";
import { buildSelfBouncePrompt, parseSelfBounceVerdict } from "./self-bounce-personas";
import { majorityVote } from "./self-consistency";

/**
 * §5.AD enforced-reasoning LOOP driver — the one effectful loop behind the gate's three kinds, pure over the
 * injected model completions (the same seam pattern as runAdaptiveAttemptLoop / runRetrievalLoop):
 *
 *  - `self_bounce_varied`: up to `rounds` critique rounds through the persona rotation; a `revise` verdict drives one
 *    revision completion (findings + draft → full revised deliverable), an `ok` verdict stops early;
 *  - `cross_model_carry`: ONE critique+repair pass on the stronger peer; its REPAIRED section replaces the draft
 *    (a missing section keeps the original — never lose work);
 *  - `self_consistency`: N independent samples, majority vote (first-seen tie-break).
 *
 * Fail-soft everywhere: any throwing completion ends the loop with the best draft so far; the loop can only ever
 * return the original draft or something a completion produced. The chat/agent wiring supplies the real model calls
 * behind an opt-in flag.
 */

export interface EnforcedReasoningLoopDeps {
	/** Complete on the SAME model that produced the draft (self-bounce critique/revise + self-consistency samples). */
	completeSelf: (input: { system?: string; user: string }) => Promise<string>;
	/** Complete on the STRONGER peer (cross_model_carry). Absent ⇒ the carry kind degrades to keeping the draft. */
	completeStronger?: (input: { system?: string; user: string }) => Promise<string>;
}

export interface EnforcedReasoningLoopInput {
	task: string;
	draft: string;
	decision: EnforcedReasoningDecision;
	deps: EnforcedReasoningLoopDeps;
	/** The drafting model's id (surfaced to the cross-model reviewer). */
	draftModelId?: string;
	/** Self-consistency sample count (default 3). */
	consistencySamples?: number;
}

export interface EnforcedReasoningLoopResult {
	finalDraft: string;
	roundsRun: number;
	/** Short trace lines (persona/verdict per round, carry findings, vote agreement) for the ledger/UI. */
	trace: string[];
	/**
	 * F3.15: the self-consistency vote's agreement rate (winner votes / total samples), present only when the
	 * consistency kind actually ran — the caller records it into the model's behavior profile so reliability and
	 * routing can learn from it (record-only feed).
	 */
	consistencyAgreement?: number;
}

export async function runEnforcedReasoningLoop(
	input: EnforcedReasoningLoopInput,
): Promise<EnforcedReasoningLoopResult> {
	const { decision, deps } = input;
	const trace: string[] = [];
	if (!decision.enforce || decision.kind === "none") {
		return { finalDraft: input.draft, roundsRun: 0, trace };
	}

	if (decision.kind === "cross_model_carry") {
		if (!deps.completeStronger) {
			trace.push("cross_model_carry: no stronger-peer completion available — kept the draft.");
			return { finalDraft: input.draft, roundsRun: 0, trace };
		}
		try {
			const prompt = buildCrossModelBouncePrompt({
				task: input.task,
				draft: input.draft,
				...(input.draftModelId !== undefined ? { draftModelId: input.draftModelId } : {}),
			});
			const reply = await deps.completeStronger({ system: prompt.system, user: prompt.user });
			const outcome = parseCrossModelBounceReply(reply);
			trace.push(`cross_model_carry: findings=${outcome.findings.slice(0, 160) || "none"}`);
			return { finalDraft: outcome.repaired ?? input.draft, roundsRun: 1, trace };
		} catch {
			trace.push("cross_model_carry: stronger-peer completion failed — kept the draft.");
			return { finalDraft: input.draft, roundsRun: 0, trace };
		}
	}

	if (decision.kind === "self_consistency") {
		const sampleCount = Math.max(2, Math.trunc(input.consistencySamples ?? 3));
		const samples: string[] = [input.draft];
		for (let index = 1; index < sampleCount; index += 1) {
			try {
				samples.push(await deps.completeSelf({ user: input.task }));
			} catch {
				break; // vote over what we have.
			}
		}
		const vote = majorityVote(samples, (sample) => sample.trim());
		trace.push(`self_consistency: ${vote.count}/${vote.total} agreement=${vote.agreement.toFixed(2)}`);
		return {
			finalDraft: vote.winner ?? input.draft,
			roundsRun: samples.length - 1,
			trace,
			consistencyAgreement: vote.agreement,
		};
	}

	// self_bounce_varied — critique rounds through the persona rotation, revising on a `revise` verdict.
	let draft = input.draft;
	let roundsRun = 0;
	for (let round = 0; round < decision.rounds; round += 1) {
		try {
			const critique = buildSelfBouncePrompt({ task: input.task, draft, round });
			const reply = await deps.completeSelf({ system: critique.system, user: critique.user });
			roundsRun += 1;
			const verdict = parseSelfBounceVerdict(reply);
			trace.push(`self_bounce round ${round} (${critique.persona}): ${verdict}`);
			if (verdict === "ok") {
				break;
			}
			const revised = await deps.completeSelf({
				user: [
					`ORIGINAL TASK:\n${input.task.trim()}`,
					`CURRENT DRAFT:\n${draft.trim()}`,
					`REVIEW FINDINGS:\n${reply.trim()}`,
					"Apply the findings and return the FULL revised deliverable only.",
				].join("\n\n"),
			});
			if (revised.trim().length > 0) {
				draft = revised.trim();
			}
		} catch {
			trace.push(`self_bounce round ${round}: completion failed — kept the current draft.`);
			break;
		}
	}
	return { finalDraft: draft, roundsRun, trace };
}
