/**
 * §5.AU — resolve the TARGET of a main-chat message: the "whose message is this?" problem. Given the raw text + the
 * session's addressing state (outstanding ASKs, visible focus, last-referenced card) + a lightweight card/stream index,
 * decide deterministically whether the message addresses a specific card (relay/answer), a stream, or the goal — or is
 * genuinely ambiguous and needs the caller to disambiguate. PURE + deterministic: no I/O, no clock, no model. The LLM
 * disambiguator (rung 5) and any "is-this-actually-an-answer" intent check live in the CALLER, gated on `needs_clarify`.
 *
 * The routing ladder (order is load-bearing — the first rung that fires wins):
 *   1. EXPLICIT HANDLE  — `@card:<id>` / `@stream:<id>` / `@<title-slug>` (the Slack @mention analogue). Highest confidence.
 *   2. REPLY-BIND       — the message answers an OUTSTANDING ASK. Deterministic when there is exactly one outstanding ASK,
 *                         or exactly one whose owning card is the current focus / last-referenced card. Multiple, none
 *                         focus-scoped ⇒ `needs_clarify` (which question?).
 *   3. FOCUS            — the session's persistent visible focus (a card/stream the user drilled into).
 *   4. GOAL             — the default: high-level guidance / new work to the conductor (today's only behavior).
 * The resolved target ALWAYS carries a `displayLabel` (the "talking to X" chip) so the target is shown + overridable.
 */

/** An outstanding ASK the user might be answering (recorded by the §5.AT bridge from an ASK verdict). */
export interface OutstandingAsk {
	/** `${taskId}:${kind}` — the §5.AT dedupe key; the pending reference. */
	signalKey: string;
	taskId: string;
	streamId?: string;
	/** A short question/label for the disambiguation candidate + the "answering: …" chip. */
	question?: string;
}

/** The minimal card/stream index the resolver matches handles against (titles slugified for `@<slug>`). */
export interface MessageTargetIndex {
	cards: readonly { id: string; title: string; streamId?: string }[];
	streams: readonly { id: string; title: string }[];
}

export interface ResolveMessageTargetInput {
	/** The raw user message. */
	text: string;
	/** ASKs currently awaiting the operator, from the §5.AT feedback bridge. */
	outstandingAsks: readonly OutstandingAsk[];
	/** The session's persistent focus (drilled-into card/stream), or null. */
	focus: { kind: "card" | "stream"; id: string } | null;
	/** The last card the conversation referenced (for focus-scoped ASK binding when focus isn't a card). */
	lastReferencedTaskId?: string | null;
	index: MessageTargetIndex;
}

export type MessageTargetKind = "answer" | "card" | "stream" | "goal" | "needs_clarify";

export interface ResolvedMessageTarget {
	kind: MessageTargetKind;
	/** The card/stream id for `card`/`stream`/`answer` (the answer's card). */
	id?: string;
	/** For `answer`: the outstanding ASK's `signalKey` being replied to. */
	pendingKey?: string;
	/** The "talking to X" chip label (always present except when clarifying). */
	displayLabel?: string;
	/** How sure the resolver is — `high` for explicit/single-binding, `medium` for focus, `low`/absent otherwise. */
	confidence: "high" | "medium" | "low";
	/** Which rung resolved it (telemetry). */
	source: "explicit_handle" | "reply_bind" | "focus" | "default" | "ambiguous";
	/** For `needs_clarify`: the candidate targets for the caller's picker (never free-routes). */
	candidates?: readonly { kind: "card" | "stream" | "answer"; id: string; label: string; pendingKey?: string }[];
	/** For `needs_clarify`: why. */
	reason?: string;
}

/** One disambiguation candidate (a `needs_clarify` target's `candidates` entry). */
export type MessageTargetCandidate = NonNullable<ResolvedMessageTarget["candidates"]>[number];

/**
 * F2.16b: build the resolved target for a candidate chosen from an ambiguous set (by the rung-5 LLM picker or the
 * operator's clarify picker), so a chosen candidate routes EXACTLY like an explicit @handle would. Pure. An
 * `answer` carries its ASK's `pendingKey`; a `card`/`stream` carries only its id + label.
 */
export function resolveTargetFromCandidate(candidate: MessageTargetCandidate): ResolvedMessageTarget {
	if (candidate.kind === "answer") {
		return {
			kind: "answer",
			id: candidate.id,
			...(candidate.pendingKey ? { pendingKey: candidate.pendingKey } : {}),
			displayLabel: candidate.label,
			confidence: "high",
			source: "explicit_handle",
		};
	}
	return {
		kind: candidate.kind,
		id: candidate.id,
		displayLabel: candidate.label,
		confidence: "high",
		source: "explicit_handle",
	};
}

/** Slugify a title for `@<slug>` matching: lowercase, non-alphanumerics → single hyphens, trimmed. */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const HANDLE_RE = /@(card|stream):([\w-]+)|@([a-z0-9][a-z0-9-]*)/i;

/**
 * §5.AU item 9 — strip the explicit `@card:`/`@stream:`/`@<slug>` handle from a message so a RELAYED message reaches the
 * card's agent clean (without the addressing token). Removes the first handle (the one the resolver matched — an explicit
 * handle always wins rung 1, so a handle present IS the resolved target) + collapses the surrounding whitespace. Returns
 * the message unchanged when no handle is present (a focus-resolved message has none). Pure.
 */
export function stripAddressingHandle(text: string): string {
	// Word-boundary-aware (start-of-text or after whitespace) — mirrors the composer's mention rule, so an `@` that isn't
	// a handle (e.g. `user@host` in an email) is never stripped. Removes the boundary whitespace + the handle, then
	// collapses the leftover whitespace.
	const match = /(?:^|\s)@(?:(?:card|stream):[\w-]+|[a-z0-9][a-z0-9-]*)/i.exec(text);
	if (!match) {
		return text;
	}
	return `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.replace(/\s{2,}/g, " ").trim();
}

function label(prefix: string, title: string): string {
	return `${prefix}${title}`;
}

/** Rung 1 — an explicit `@card:id` / `@stream:id` / `@<title-slug>` handle. Returns null when no handle is present. */
function resolveExplicitHandle(text: string, index: MessageTargetIndex): ResolvedMessageTarget | null {
	const match = HANDLE_RE.exec(text);
	if (!match) {
		return null;
	}
	const [, kindTag, idTag, slugTag] = match;
	if (kindTag === "card" && idTag) {
		const card = index.cards.find((c) => c.id === idTag);
		return card
			? {
					kind: "card",
					id: card.id,
					displayLabel: label("card ", card.title),
					confidence: "high",
					source: "explicit_handle",
				}
			: null;
	}
	if (kindTag === "stream" && idTag) {
		const stream = index.streams.find((s) => s.id === idTag);
		return stream
			? {
					kind: "stream",
					id: stream.id,
					displayLabel: label("#", stream.title),
					confidence: "high",
					source: "explicit_handle",
				}
			: null;
	}
	if (slugTag) {
		const slug = slugTag.toLowerCase();
		const cardHits = index.cards.filter((c) => slugify(c.title) === slug);
		const streamHits = index.streams.filter((s) => slugify(s.title) === slug);
		const hits = [
			...cardHits.map((c) => ({ kind: "card" as const, id: c.id, label: label("card ", c.title) })),
			...streamHits.map((s) => ({ kind: "stream" as const, id: s.id, label: label("#", s.title) })),
		];
		if (hits.length === 1) {
			const only = hits[0];
			if (only) {
				return {
					kind: only.kind,
					id: only.id,
					displayLabel: only.label,
					confidence: "high",
					source: "explicit_handle",
				};
			}
		}
		if (hits.length > 1) {
			return {
				kind: "needs_clarify",
				confidence: "low",
				source: "ambiguous",
				reason: `"@${slug}" matches ${hits.length} targets`,
				candidates: hits,
			};
		}
	}
	return null;
}

/**
 * Rung 2 — bind the message to an outstanding ASK it answers. Deterministic when exactly one ASK is outstanding, or when
 * exactly one outstanding ASK belongs to the focused / last-referenced card; ambiguous (multiple, none focus-scoped) ⇒
 * `needs_clarify`. Returns null when there are no outstanding ASKs.
 */
function resolveReplyBind(input: ResolveMessageTargetInput): ResolvedMessageTarget | null {
	const asks = input.outstandingAsks;
	if (asks.length === 0) {
		return null;
	}
	const bind = (ask: OutstandingAsk): ResolvedMessageTarget => ({
		kind: "answer",
		id: ask.taskId,
		pendingKey: ask.signalKey,
		displayLabel: `answering: ${ask.question ?? ask.taskId}`,
		confidence: "high",
		source: "reply_bind",
	});
	if (asks.length === 1) {
		const only = asks[0];
		return only ? bind(only) : null;
	}
	// Multiple outstanding ASKs — bind only if exactly one is scoped to the focused / last-referenced card.
	const scopeId = input.focus?.kind === "card" ? input.focus.id : (input.lastReferencedTaskId ?? null);
	if (scopeId) {
		const scoped = asks.filter((a) => a.taskId === scopeId);
		const first = scoped[0];
		if (scoped.length === 1 && first) {
			return bind(first);
		}
	}
	return {
		kind: "needs_clarify",
		confidence: "low",
		source: "ambiguous",
		reason: `${asks.length} questions are awaiting your answer`,
		candidates: asks.map((a) => ({
			kind: "answer" as const,
			id: a.taskId,
			label: a.question ?? a.taskId,
			pendingKey: a.signalKey,
		})),
	};
}

/** Rung 3 — the session's persistent focus. */
function resolveFocus(input: ResolveMessageTargetInput): ResolvedMessageTarget | null {
	if (!input.focus) {
		return null;
	}
	if (input.focus.kind === "card") {
		const card = input.index.cards.find((c) => c.id === input.focus?.id);
		return {
			kind: "card",
			id: input.focus.id,
			displayLabel: label("card ", card?.title ?? input.focus.id),
			confidence: "medium",
			source: "focus",
		};
	}
	const stream = input.index.streams.find((s) => s.id === input.focus?.id);
	return {
		kind: "stream",
		id: input.focus.id,
		displayLabel: label("#", stream?.title ?? input.focus.id),
		confidence: "medium",
		source: "focus",
	};
}

/**
 * Resolve the target of a main-chat message via the deterministic ladder (explicit handle → reply-bind → focus → goal).
 * Pure. When it returns `needs_clarify`, the caller runs the LLM disambiguator over `candidates` (rung 5) — this core
 * never free-routes with a model.
 */
export function resolveMessageTarget(input: ResolveMessageTargetInput): ResolvedMessageTarget {
	return (
		resolveExplicitHandle(input.text, input.index) ??
		resolveReplyBind(input) ??
		resolveFocus(input) ?? { kind: "goal", displayLabel: "Goal", confidence: "high", source: "default" }
	);
}

/**
 * Render the resolved target as the system note that leads the chat turn — how the addressing decision reaches the
 * model. `goal` (the default) renders null: the un-targeted turn stays byte-identical to today's prompt (§5.AQ —
 * no cache churn for the common case). `needs_clarify` instructs the model to ASK, never to guess a target.
 */
export function renderMessageTargetNote(target: ResolvedMessageTarget): string | null {
	if (target.kind === "card" && target.id) {
		// A sticky-focus binding (rung 3) is context, not a directive — the user may be changing subject; the
		// explicit/reply-bound rungs are the user's own addressing and read as an instruction.
		return target.source === "focus"
			? `The conversation is currently focused on board card "${target.displayLabel ?? target.id}" (id: ${target.id}) — treat card-specific guidance as being about it unless the user clearly changes subject.`
			: `This message addresses board card "${target.displayLabel ?? target.id}" (id: ${target.id}). Apply the user's guidance to THIS card — use get_board if you need its current column/state.`;
	}
	if (target.kind === "stream" && target.id) {
		return target.source === "focus"
			? `The conversation is currently focused on the work stream ${target.displayLabel ?? target.id} (id: ${target.id}) — treat stream-specific guidance as being about it unless the user clearly changes subject.`
			: `This message addresses the work stream ${target.displayLabel ?? target.id} (id: ${target.id}). Apply the user's guidance to that stream's cards — use get_board to see them.`;
	}
	if (target.kind === "answer" && target.id) {
		return `The user is ANSWERING the outstanding question on card ${target.id}${target.displayLabel ? ` (${target.displayLabel})` : ""}. Treat the message as that answer and act on it for this card.`;
	}
	if (target.kind === "needs_clarify") {
		const options = (target.candidates ?? []).map((candidate) => `"${candidate.label}"`).join(", ");
		return `The user's message ambiguously addresses one of: ${options || "several targets"}${target.reason ? ` (${target.reason})` : ""}. Ask which one they mean before acting — do not guess.`;
	}
	return null;
}
