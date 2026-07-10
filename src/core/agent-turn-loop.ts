// §5.AG within-SESSION turn-loop detection + boundary escalation (todo 10983, David 2026-07-10, live-observed:
// qwen3.6-35b-a3b looped endlessly re-raising "is the *.js test command correct?" when the sources were *.ts).
//
// This is a DIFFERENT granularity from `agent-stuckness.ts`: that classifies the ATTEMPT stream across sessions/
// models (the §5.AF ledger); THIS inspects the assistant TURNS inside ONE running session and catches a model that
// keeps re-raising the SAME question/proposal/tool-call instead of progressing — a "solution outside the allowed
// space" loop where every path the model wants is blocked by the task/gates, so it never moves.
//
// Pure + dependency-free (mirrors the other detectors): turns in, a verdict out; the caller effects the escalation.

/** One assistant turn's observable surface, reduced to what loop-detection fingerprints. */
export interface AgentLoopTurn {
	/** The turn's visible text (content and/or reasoning) — the recurring question is extracted from here. */
	text: string;
	/** Tool calls made this turn (name + a stable argument fingerprint); a repeated identical call also loops. */
	toolCalls?: readonly { name: string; argsKey?: string }[];
}

export type TurnLoopKind = "none" | "repeat" | "oscillation";

export interface TurnLoopVerdict {
	kind: TurnLoopKind;
	/** How many of the trailing turns participate in the loop. */
	occurrences: number;
	/** The repeated fingerprint (`repeat`) or the two alternating fingerprints joined by `|` (`oscillation`). */
	fingerprint: string | null;
	/** The extracted recurring question / contested boundary, or null when none was recognizable. */
	contestedQuestion: string | null;
}

export interface TurnLoopPolicy {
	/** Trailing turns that must share ONE fingerprint to call a `repeat`. */
	minRepeats: number;
	/** Trailing turns that must alternate between exactly TWO fingerprints to call an `oscillation` (≥4 = A,B,A,B). */
	minOscillations: number;
	/** How many trailing turns to inspect. */
	window: number;
}

export const DEFAULT_TURN_LOOP_POLICY: TurnLoopPolicy = {
	minRepeats: 3,
	minOscillations: 4,
	window: 8,
};

/**
 * Reduce a turn to a stable fingerprint: normalized text gist (lowercased, whitespace-collapsed, punctuation
 * dropped except `?`, bounded length) PLUS the sorted tool-call signatures. Near-identical re-raises of the same
 * question collapse to one key; a different proposal/tool-call yields a different key. Digits and quoted/bracketed
 * literals are KEPT (the contested token — e.g. `*.js` vs `*.ts` — is the whole point) but volatile ids are not
 * specially stripped: the bounded prefix keeps the gist stable enough for repeat/oscillation without over-fitting.
 */
export function turnFingerprint(turn: AgentLoopTurn): string {
	const textGist = turn.text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}?*.]+/gu, " ")
		.replace(/\s+/gu, " ")
		.trim()
		.slice(0, 200);
	const tools = (turn.toolCalls ?? [])
		.map((call) => `${call.name}(${call.argsKey ?? ""})`)
		.sort()
		.join(",");
	return `${textGist}##${tools}`;
}

/**
 * Extract the recurring question / contested boundary from a turn's text — so the escalation NAMES the specific
 * conflict ("acceptance command targets *.js but sources are *.ts") instead of a useless "stuck". Prefers an
 * interrogative sentence; falls back to a sentence carrying a conflict marker (but/however/targets/expects/…).
 */
export function extractContestedQuestion(text: string): string | null {
	const sentences = text
		.split(/(?<=[.?!])\s+|\n+/u)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length > 0);
	const question = [...sentences].reverse().find((sentence) => sentence.endsWith("?"));
	if (question) {
		return question.slice(0, 240);
	}
	const conflictMarker = /\b(but|however|targets?|expects?|requires?|allowed|outside|instead of|conflict|mismatch)\b/i;
	const conflict = [...sentences].reverse().find((sentence) => conflictMarker.test(sentence));
	return conflict ? conflict.slice(0, 240) : null;
}

/**
 * Detect a within-session turn loop over the trailing `window` turns:
 *   - `repeat` — the last `minRepeats` turns share one fingerprint (the same question re-raised).
 *   - `oscillation` — the last turns alternate between exactly two fingerprints (bouncing between two proposals).
 * Returns `none` otherwise. The contested question is pulled from the most recent looping turn.
 */
export function detectTurnLoop(
	turns: readonly AgentLoopTurn[],
	policy: TurnLoopPolicy = DEFAULT_TURN_LOOP_POLICY,
): TurnLoopVerdict {
	const none: TurnLoopVerdict = { kind: "none", occurrences: 0, fingerprint: null, contestedQuestion: null };
	const window = turns.slice(-Math.max(1, policy.window));
	if (window.length < Math.min(policy.minRepeats, policy.minOscillations)) {
		return none;
	}
	const prints = window.map(turnFingerprint);

	// Repeat: count the trailing run of one identical fingerprint.
	const lastPrint = prints[prints.length - 1] as string;
	let repeatRun = 0;
	for (let index = prints.length - 1; index >= 0 && prints[index] === lastPrint; index -= 1) {
		repeatRun += 1;
	}
	if (repeatRun >= policy.minRepeats) {
		const source = window[window.length - 1] as AgentLoopTurn;
		return {
			kind: "repeat",
			occurrences: repeatRun,
			fingerprint: lastPrint,
			contestedQuestion: extractContestedQuestion(source.text),
		};
	}

	// Oscillation: the trailing turns alternate between exactly two fingerprints (A,B,A,B,…). The last two turns
	// seed the pattern; each earlier turn extends it while it matches the turn TWO ahead of it.
	let oscRun = Math.min(2, prints.length);
	for (let index = prints.length - 3; index >= 0; index -= 1) {
		if (prints[index] === prints[index + 2]) {
			oscRun += 1;
		} else {
			break;
		}
	}
	const distinctTail = new Set(prints.slice(prints.length - oscRun));
	if (oscRun >= policy.minOscillations && distinctTail.size === 2) {
		// Name the boundary from the most recent turn carrying a recognizable question.
		const source =
			[...window].reverse().find((turn) => extractContestedQuestion(turn.text) !== null) ??
			(window[window.length - 1] as AgentLoopTurn);
		return {
			kind: "oscillation",
			occurrences: oscRun,
			fingerprint: [...distinctTail].join("|"),
			contestedQuestion: extractContestedQuestion(source.text),
		};
	}

	return none;
}

/**
 * The card/prompt convention: one `Acceptance check: <command>` line. Kept in sync with the impure mirror in
 * nklein-agent/nklein-acceptance-gate.ts and the pure one in plan-integration-gate.ts — the wiring layer needs it
 * HERE so the turn-loop resolution can pull the authoritative acceptance command straight from a session's start
 * prompt without importing an impure module.
 */
const ACCEPTANCE_CHECK_PATTERN = /^Acceptance check:\s*(.+?)\s*$/im;

/** Extract the card's embedded `Acceptance check:` command from its prompt text, or null when absent. */
export function extractAcceptanceCheckCommand(promptText: string): string | null {
	const command = promptText.match(ACCEPTANCE_CHECK_PATTERN)?.[1]?.trim();
	return command && command.length > 0 ? command : null;
}

/** The next move once a turn loop is confirmed (pure; the caller effects it). */
export type TurnLoopResolution =
	/** No loop — keep running. */
	| { kind: "continue" }
	/**
	 * The contested boundary is DERIVABLE from the acceptance/spec context (the answer is authoritative there —
	 * e.g. the acceptance command settles which test-file extension is correct). Inject the guidance and continue.
	 */
	| { kind: "auto_resolve"; guidance: string }
	/**
	 * Not auto-resolvable, but an UNTRIED model remains — route the boundary question to it (§5.AG Layer 1,
	 * automatic, no user). A different family often breaks a boundary loop the current model can't escape.
	 */
	| { kind: "escalate_model"; modelId: string; boundary: string }
	/** Not auto-resolvable and every model tried — PARK with a needs-you stating the SPECIFIC question (Layer 2). */
	| { kind: "park_needs_you"; question: string };

export interface TurnLoopResolutionInput {
	verdict: TurnLoopVerdict;
	/**
	 * Authoritative context the boundary might be derivable from — the card's acceptance command + spec/plan text.
	 * When the contested question references a token that appears here, the acceptance context is treated as
	 * authoritative and the loop auto-resolves with a guidance nudge quoting it.
	 */
	acceptanceCommand?: string | null;
	specContext?: string | null;
	/** Models already attempted for this card. */
	triedModelIds?: readonly string[];
	/** Available/loaded models, best-fit first — the next untried one is picked for escalation. */
	availableModelIds?: readonly string[];
}

/**
 * Extract the salient tokens from a contested question that a resolution should look for in the acceptance/spec
 * context — file-glob/extension tokens (`*.js`, `.ts`), commands, and quoted literals. Kept deliberately narrow so
 * a chance word-overlap doesn't fake an auto-resolution.
 */
export function contestedTokens(question: string): string[] {
	const tokens = new Set<string>();
	for (const match of question.matchAll(
		/\*?\.[a-z0-9]{1,6}\b|`[^`]+`|"[^"]+"|\b(?:npm|node|vitest|jest|tsc|pytest|cargo|go)\b[^.?!]*/gi,
	)) {
		const token = match[0].replace(/[`"]/g, "").trim();
		if (token.length >= 2) {
			tokens.add(token.toLowerCase());
		}
	}
	return [...tokens];
}

/**
 * Decide how to break a confirmed turn loop, per the §5.AG ladder applied to the boundary case: auto-resolve from
 * authoritative context first (no human, no other model); else route to an untried model (Layer 1); else park with
 * the specific question (Layer 2). A `none` verdict is `continue`.
 */
export function decideTurnLoopResolution(input: TurnLoopResolutionInput): TurnLoopResolution {
	const { verdict } = input;
	if (verdict.kind === "none") {
		return { kind: "continue" };
	}
	const question = verdict.contestedQuestion;
	const acceptance = (input.acceptanceCommand ?? "").toLowerCase();
	const spec = (input.specContext ?? "").toLowerCase();
	// Quote-normalize the grounding haystack: contestedTokens strips backticks/quotes from its tokens (a model
	// quotes the command it is asking about), so the context must shed them too or a quoted acceptance command
	// (`node -e "process.exit(0)"`) can never ground against its own token (live-found via the §12 a-same-question
	// simulator regression — the guard parked instead of auto-resolving).
	const context = `${acceptance}\n${spec}`.replace(/["'`]/g, "");

	// (1) Auto-resolve: the contested token appears in the authoritative context ⇒ that context settles it.
	if (question) {
		const tokens = contestedTokens(question);
		const grounded = tokens.filter((token) => context.includes(token));
		if (grounded.length > 0 && acceptance.length > 0) {
			return {
				kind: "auto_resolve",
				guidance:
					`You are looping on: "${question}". The acceptance command is authoritative — treat it as the source of ` +
					`truth and align to it: \`${input.acceptanceCommand}\`. Stop re-asking; make the smallest change that ` +
					`satisfies that command and proceed.`,
			};
		}
	}

	// (2) Escalate to an untried model (§5.AG Layer 1) — a different family often escapes a boundary the current
	// model cannot. Prefer this over bothering the user.
	const tried = new Set(input.triedModelIds ?? []);
	const nextModel = (input.availableModelIds ?? []).find((modelId) => !tried.has(modelId));
	const boundary = question ?? "the recurring proposal it cannot get past";
	if (nextModel !== undefined) {
		return { kind: "escalate_model", modelId: nextModel, boundary };
	}

	// (3) Park with the SPECIFIC question (Layer 2) — never a generic "stuck".
	return {
		kind: "park_needs_you",
		question: question ?? "The agent is looping on a boundary it cannot resolve; review the recent turns and decide.",
	};
}
