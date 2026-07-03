// §5.BB phase 2 — @-MENTION targeting in the chat composer: typing "@" suggests cards/streams and inserts the
// explicit handle (`@card:<id>` / `@stream:<id>`) that the §5.AU message-target resolver's rung 1 understands —
// the composer teaches the addressing syntax instead of asking the user to memorize it. Pure helpers (detection,
// filtering, insertion) so the whole behavior is unit-testable; the popover in the chat panel just renders them.

export interface MentionCandidate {
	kind: "card" | "stream";
	id: string;
	title: string;
}

export interface ActiveMention {
	/** Index of the "@" in the draft. */
	start: number;
	/** What's typed between the "@" and the caret (never contains whitespace). */
	query: string;
}

/**
 * The mention being typed at `caret`, or null. An "@" only opens a mention when it starts a token (preceded by
 * start-of-text or whitespace — `user@host` stays plain text) and the text back to the caret has no whitespace.
 */
export function getActiveMention(draft: string, caret: number): ActiveMention | null {
	const upToCaret = draft.slice(0, Math.max(0, Math.min(caret, draft.length)));
	const at = upToCaret.lastIndexOf("@");
	if (at === -1) {
		return null;
	}
	if (at > 0 && !/\s/.test(upToCaret[at - 1] ?? "")) {
		return null;
	}
	const query = upToCaret.slice(at + 1);
	if (/\s/.test(query)) {
		return null;
	}
	return { start: at, query };
}

const MENTION_LIMIT = 6;

/** Rank candidates for `query`: title-prefix beats title-substring beats id-substring; ties by title. Cap 6. */
export function filterMentionCandidates(query: string, candidates: readonly MentionCandidate[]): MentionCandidate[] {
	const needle = query.toLowerCase();
	const scored: { candidate: MentionCandidate; score: number }[] = [];
	for (const candidate of candidates) {
		const title = candidate.title.toLowerCase();
		const id = candidate.id.toLowerCase();
		const score =
			needle.length === 0 || title.startsWith(needle)
				? 0
				: title.includes(needle)
					? 1
					: id.includes(needle)
						? 2
						: -1;
		if (score >= 0) {
			scored.push({ candidate, score });
		}
	}
	scored.sort((left, right) => left.score - right.score || left.candidate.title.localeCompare(right.candidate.title));
	return scored.slice(0, MENTION_LIMIT).map((entry) => entry.candidate);
}

/** Replace the mention token [start, caret) with the candidate's explicit handle + a space; returns the new caret. */
export function applyMention(
	draft: string,
	mention: ActiveMention,
	caret: number,
	candidate: MentionCandidate,
): { next: string; caret: number } {
	const handle = `@${candidate.kind}:${candidate.id} `;
	const next = draft.slice(0, mention.start) + handle + draft.slice(Math.max(mention.start, caret));
	return { next, caret: mention.start + handle.length };
}
