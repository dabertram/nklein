/**
 * P16.3 + P16.7 — the review surface's consent model and the GitHub-issue DRAFT renderer. PURE core.
 *
 * David's constraints: the user reviews the EXACT bytes before anything exists as an artifact, controls it per
 * item, and **!Klein never submits**. The transport is a draft the user sends themselves.
 *
 * ── WHY THE TOGGLE MODEL LIVES WITH THE RENDERER ──
 * The review surface and the transport must agree byte-for-byte, or review is theatre. Keeping the consent
 * projection and the markdown renderer in ONE module means the bytes shown and the bytes rendered come from the
 * same code — a reviewer verifies that by reading one file instead of trusting two to stay in sync.
 *
 * ── THE APPROVAL-VIEW FIDELITY HAZARD (and a live demonstration of it) ──
 * The MCP tool-poisoning literature documents Unicode TAG-block payloads that are INVISIBLE in an approval UI but
 * present in the model's context (arXiv 2607.05744). The same class applies here in reverse: content that renders
 * harmlessly in a review pane but carries hidden characters into a PUBLIC issue.
 *
 * This is not theoretical. While writing this module, the authoring tool REJECTED the command because the
 * character class below had been written with literal invisible characters — "command contains control
 * characters that would be hidden in the approval dialog". The hazard demonstrated itself during the
 * implementation of its own detector. Hence: the class is written with \u escapes ONLY, and never as literals.
 */

export interface ReviewItem {
	readonly key: string;
	readonly layer: "A" | "B" | "C";
	/** The exact bytes this item contributes. */
	readonly bytes: string;
	/** What including it discloses, shown beside the toggle. */
	readonly reveals: string;
	/** The user's per-item decision. Anything above Layer A defaults to false. */
	readonly included: boolean;
}

export interface ReviewState {
	readonly items: readonly ReviewItem[];
	/** Running disclosure list, recomputed on every toggle so the user always sees CURRENT exposure. */
	readonly revealsNow: readonly string[];
	readonly includedCount: number;
	readonly totalBytes: number;
}

/** Project the current toggle state. Pure, so the UI cannot drift from what the renderer will emit. */
export function projectReviewState(items: readonly ReviewItem[]): ReviewState {
	const included = items.filter((item) => item.included);
	return {
		items,
		revealsNow: included.map((item) => item.reveals),
		includedCount: included.length,
		totalBytes: included.reduce((sum, item) => sum + item.bytes.length, 0),
	};
}

/**
 * Is this code point invisible / control / bidi / tag?
 *
 * Expressed as a NUMERIC PREDICATE rather than a regex, and that is not stylistic. This hazard blocked its own
 * detector three times during implementation:
 *   1. the authoring tool refused the command — "command contains control characters that would be hidden in the
 *      approval dialog" — because the class was written with literal invisibles;
 *   2. rewritten with `\u` escapes, the LINTER refused it (`noControlCharactersInRegex`: "control characters are
 *      unusual and potentially incorrect inputs, so they are disallowed");
 *   3. only a code-point comparison expresses the intent without embedding the characters at all.
 *
 * Three independent tools objecting to the same construct is a strong signal that a regex is the wrong shape
 * here. Comparing numbers is also plainly readable, which a dense escape class is not.
 */
function isHiddenCodePoint(codePoint: number): boolean {
	// C0 controls except tab (0x09), newline (0x0A) and carriage return (0x0D), which are legitimate text.
	if (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) {
		return true;
	}
	if (codePoint === 0x7f || codePoint === 0x00ad) {
		return true; // DEL, soft hyphen
	}
	if (codePoint >= 0x200b && codePoint <= 0x200f) {
		return true; // zero-width + directional marks
	}
	if (codePoint === 0x2028 || codePoint === 0x2029) {
		return true; // line/paragraph separators
	}
	if (codePoint >= 0x202a && codePoint <= 0x202e) {
		return true; // bidi embedding/override
	}
	if (codePoint >= 0x2060 && codePoint <= 0x2064) {
		return true; // word joiner + invisible operators
	}
	if (codePoint === 0xfeff) {
		return true; // BOM / zero-width no-break space
	}
	// Unicode TAG block — the arXiv 2607.05744 payload class.
	return codePoint >= 0xe0000 && codePoint <= 0xe007f;
}

export interface HiddenCharacterFinding {
	readonly key: string;
	readonly codePoints: readonly string[];
}

/**
 * Find invisible/control characters in the items about to be sent.
 *
 * A review pane shows GLYPHS, not bytes, so a payload can be invisible on screen and present in the artifact.
 * Reporting the CODE POINTS rather than "found something" is what lets a user see exactly what is there.
 */
export function detectHiddenCharacters(items: readonly ReviewItem[]): HiddenCharacterFinding[] {
	const findings: HiddenCharacterFinding[] = [];
	for (const item of items) {
		if (!item.included) {
			continue;
		}
		const points = new Set<string>();
		for (const char of [...item.bytes]) {
			const codePoint = char.codePointAt(0) ?? 0;
			if (isHiddenCodePoint(codePoint)) {
				points.add(`U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`);
			}
		}
		if (points.size > 0) {
			findings.push({ key: item.key, codePoints: [...points].sort() });
		}
	}
	return findings;
}

export type DraftResult =
	| { readonly ok: true; readonly markdown: string }
	| { readonly ok: false; readonly reason: string; readonly hiddenCharacters: readonly HiddenCharacterFinding[] };

export interface DraftOptions {
	readonly title: string;
	readonly disclosure: string;
	/** Set ONLY after the user has seen the hidden-character report and chosen to proceed. */
	readonly acknowledgedHiddenCharacters?: boolean;
}

/**
 * Render the GitHub-issue draft. **Returns markdown for the user to submit; never submits anything.**
 *
 * Refuses when included content carries hidden characters the user has not acknowledged. The caller must surface
 * that refusal rather than swallow it — the entire point is that the user sees what they are sending.
 */
export function renderIssueDraft(state: ReviewState, options: DraftOptions): DraftResult {
	const hidden = detectHiddenCharacters(state.items);
	if (hidden.length > 0 && options.acknowledgedHiddenCharacters !== true) {
		return {
			ok: false,
			reason: `${hidden.length} included item(s) contain invisible or control characters. A review pane shows glyphs, not bytes, so these would travel unseen into a public issue — review them before proceeding.`,
			hiddenCharacters: hidden,
		};
	}

	const included = state.items.filter((item) => item.included);
	const markdown = [
		`# ${options.title}`,
		"",
		"> Generated by !Klein on the reporter's own machine, from their own telemetry, and reviewed by them before",
		"> submission. !Klein did not send this — a person did.",
		"",
		"## What this report discloses",
		"",
		options.disclosure,
		"",
		...(included.length === 0
			? ["_No items were included._", ""]
			: included.flatMap((item) => [
					`### ${item.key}  _(layer ${item.layer})_`,
					"",
					`<!-- discloses: ${item.reveals} -->`,
					"",
					"```",
					item.bytes,
					"```",
					"",
				])),
	].join("\n");

	return { ok: true, markdown };
}
