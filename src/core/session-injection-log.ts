/**
 * §dsh#31 slice B1 — the WRITE-AHEAD INJECTION LOG (pure core): every message the context-focus extension adds
 * to a model request is durably recorded AT INJECT TIME, closing the "model-visible but persisted nowhere" gap
 * the slice-A audit measured (0/7 requests reconstructable; focus brief / repo-map rail / retry note named).
 *
 * The capture is a DIFF at the hook's single exit: any outgoing message whose id was not in the entry set was
 * added by this hook — so present AND FUTURE injectors are covered by construction, with no per-site taps to
 * forget. Kinds classify by the injectors' own structured id prefixes (`kanban-drift-critic-…`), falling back
 * to content markers, then "other" — an unknown kind is still a logged injection, never a dropped one.
 * Effects (file IO) live in src/state/session-injection-log-store.ts.
 */

import { z } from "zod";

export const sessionInjectionRecordSchema = z.object({
	schemaVersion: z.literal(1),
	sessionId: z.string().min(1),
	/** Classified injector kind (open set — see classifyInjectionKind). */
	kind: z.string(),
	/** The injected message's role. */
	role: z.string(),
	/** The injected content, verbatim (flattened text). */
	content: z.string(),
	recordedAt: z.string(),
});
export type SessionInjectionRecord = z.infer<typeof sessionInjectionRecordSchema>;

/** A message shape sufficient for the diff — the SDK's AgentMessage satisfies this structurally. */
export interface InjectionDiffMessage {
	id?: string;
	role: string;
	content: string;
}

const ID_PREFIX_KINDS: ReadonlyArray<{ prefix: string; kind: string }> = [
	{ prefix: "kanban-focus-chain-rail", kind: "focus_chain_rail" },
	{ prefix: "kanban-drift-critic", kind: "drift_critic_note" },
	{ prefix: "kanban-stall-replan", kind: "stall_replan" },
	{ prefix: "kanban-tool-trust", kind: "tool_trust_guidance" },
	{ prefix: "kanban-goal-reanchor", kind: "goal_reanchor" },
	{ prefix: "kanban-card-contract", kind: "card_contract" },
];

const CONTENT_MARKER_KINDS: ReadonlyArray<{ marker: string; kind: string }> = [
	{ marker: "[!Klein context focus brief]", kind: "focus_brief" },
	{ marker: "[!Klein repo map", kind: "repo_map_rail" },
	{ marker: "Already attempted this task", kind: "retry_note" },
];

/** Classify one injected message; unknown shapes are "other", never dropped. */
export function classifyInjectionKind(message: InjectionDiffMessage): string {
	const id = message.id ?? "";
	for (const { prefix, kind } of ID_PREFIX_KINDS) {
		if (id.startsWith(prefix)) {
			return kind;
		}
	}
	for (const { marker, kind } of CONTENT_MARKER_KINDS) {
		if (message.content.includes(marker)) {
			return kind;
		}
	}
	return "other";
}

/**
 * The hook-exit diff: outgoing messages whose id was NOT present at entry (or that carry no id at all) were
 * added by the hook this request. Merge-normalization can synthesize combined rows with fresh ids — those
 * classify by their embedded content markers, which is the right attribution (the merged row carries the
 * injected text the model will actually see).
 */
export function diffInjectedMessages(
	entryMessages: readonly InjectionDiffMessage[],
	outgoingMessages: readonly InjectionDiffMessage[],
): InjectionDiffMessage[] {
	const entryContentById = new Map<string, string>();
	for (const message of entryMessages) {
		if (message.id) {
			entryContentById.set(message.id, message.content);
		}
	}
	return outgoingMessages.filter((message) => {
		if (!message.id || !entryContentById.has(message.id)) {
			return true; // added row
		}
		// Same id, REWRITTEN content: an in-place injection (the read-files focus brief embeds this way) —
		// record it too, or the rewrite reaches the model unlogged.
		return entryContentById.get(message.id) !== message.content;
	});
}

export function buildSessionInjectionRecords(input: {
	sessionId: string;
	entryMessages: readonly InjectionDiffMessage[];
	outgoingMessages: readonly InjectionDiffMessage[];
	recordedAt: string;
}): SessionInjectionRecord[] {
	return diffInjectedMessages(input.entryMessages, input.outgoingMessages).map((message) =>
		sessionInjectionRecordSchema.parse({
			schemaVersion: 1,
			sessionId: input.sessionId,
			kind: classifyInjectionKind(message),
			role: message.role,
			content: message.content,
			recordedAt: input.recordedAt,
		}),
	);
}
