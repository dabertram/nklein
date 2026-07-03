// §5.BB phase 2 — chat↔board linkage: find CARD REFERENCES inside a chat message so the transcript can render
// them as openable chips (click → the card opens in the main panel). Pure and board-driven: a reference is an
// exact card ID or a case-insensitive card TITLE occurrence (longest titles matched first so "trend tests"
// inside "expand trend tests" resolves to the more specific card). Overlaps are consumed left-to-right.

export interface ChatCardCandidate {
	id: string;
	title: string;
}

export type ChatMessageSegment = { kind: "text"; text: string } | { kind: "card"; cardId: string; label: string };

/** Titles shorter than this are too ambiguous to auto-chip (e.g. a card titled "CLI"). */
const MIN_TITLE_MATCH_LENGTH = 6;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a chat message into text and card-chip segments. Card IDs match exactly; titles match on word
 * boundaries, case-insensitively, longest-first. Returns a single text segment when nothing matches.
 */
export function segmentChatMessage(content: string, cards: readonly ChatCardCandidate[]): ChatMessageSegment[] {
	if (content.length === 0 || cards.length === 0) {
		return [{ kind: "text", text: content }];
	}
	const patterns = cards
		.flatMap((card) => {
			const entries: { pattern: string; cardId: string; label: string; exact: string | null }[] = [
				// Card IDs must match case-EXACTLY (an id like "cli" must not swallow the word "CLI").
				{ pattern: escapeRegExp(card.id), cardId: card.id, label: card.title, exact: card.id },
			];
			const title = card.title.trim();
			if (title.length >= MIN_TITLE_MATCH_LENGTH) {
				entries.push({ pattern: escapeRegExp(title), cardId: card.id, label: card.title, exact: null });
			}
			return entries;
		})
		.sort((left, right) => right.pattern.length - left.pattern.length);
	if (patterns.length === 0) {
		return [{ kind: "text", text: content }];
	}
	const combined = new RegExp(`(?:^|(?<=\\W))(${patterns.map((entry) => entry.pattern).join("|")})(?=\\W|$)`, "gi");
	const segments: ChatMessageSegment[] = [];
	let cursor = 0;
	for (const match of content.matchAll(combined)) {
		const start = match.index ?? 0;
		const matchedText = match[1] ?? "";
		if (matchedText.length === 0) {
			continue;
		}
		const owner = patterns.find((entry) =>
			entry.exact !== null ? matchedText === entry.exact : new RegExp(`^${entry.pattern}$`, "i").test(matchedText),
		);
		if (!owner) {
			continue;
		}
		if (start > cursor) {
			segments.push({ kind: "text", text: content.slice(cursor, start) });
		}
		segments.push({ kind: "card", cardId: owner.cardId, label: matchedText });
		cursor = start + matchedText.length;
	}
	if (segments.length === 0) {
		return [{ kind: "text", text: content }];
	}
	if (cursor < content.length) {
		segments.push({ kind: "text", text: content.slice(cursor) });
	}
	return segments;
}
