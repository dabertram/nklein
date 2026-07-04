/**
 * §5.AK — the generate-N-patches prompt (the model's ONE narrow generative subtask in the repair kernel). Given the
 * localized fault context, it asks the model for N *distinct* candidate fixes, each as a fenced unified diff and nothing
 * else — the exact shape {@link ../core/patch-candidate-parser.parseNPatchCandidates} parses. Keeping the prompt in one
 * pure builder means the format contract (fenced ```diff blocks · `diff --git`/`--- a/`/`+++ b/` headers · `@@` hunks ·
 * touch only in-scope files · no prose) lives next to the parser that enforces it, so the two can't drift.
 *
 * The point of asking for N candidates (not one) is DIVERSITY: independent attempts from different angles give the
 * validator + ranker something to choose between, which is how the harness gets a good fix out of a weak local model.
 */

/** One localized fault site the generator works from (read-only — the model proposes edits, it does not browse). */
export interface LocalizedContextEntry {
	/** A localization ref (`file[:symbol|:span]`) the fault was traced to. */
	ref: string;
	/** An optional source snippet for that ref (the read-only localization provider may attach it). */
	snippet?: string;
}

export interface PatchGenerationPromptInput {
	/** What's broken — the failing behavior / reproduction summary the candidates must fix. */
	bugSummary: string;
	/** The localized fault sites the model should work from. */
	localizedContext: readonly LocalizedContextEntry[];
	/** How many DISTINCT candidate patches to ask for (clamped to ≥ 1). */
	candidateCount: number;
	/** When set, the ONLY files the model may touch — echoed as a hard scope constraint. */
	allowedPaths?: readonly string[];
}

/** A system/user prompt pair ready for the local chat completion. */
export interface PatchGenerationPrompt {
	system: string;
	user: string;
}

/** Render the localized context as a compact, readable block (ref + optional fenced snippet). */
function renderContext(entries: readonly LocalizedContextEntry[]): string {
	if (entries.length === 0) {
		return "(no localized context was provided — infer the fix site from the bug summary alone)";
	}
	return entries
		.map((entry) => {
			const snippet = entry.snippet?.trim();
			return snippet ? `- ${entry.ref}\n\`\`\`\n${snippet}\n\`\`\`` : `- ${entry.ref}`;
		})
		.join("\n");
}

/**
 * Build the generate-N-patches prompt. `candidateCount` is clamped to at least 1 (a fix run must ask for at least one
 * candidate). `allowedPaths`, when given, is echoed as the hard edit scope so the parser's out-of-scope rejection and
 * the prompt agree on the same boundary.
 */
export function buildPatchGenerationPrompt(input: PatchGenerationPromptInput): PatchGenerationPrompt {
	const count = Math.max(1, Math.trunc(input.candidateCount));
	const plural = count === 1 ? "candidate patch" : "distinct candidate patches";

	const scopeRule = input.allowedPaths?.length
		? `- Edit ONLY these files (any diff touching another path will be rejected):\n${input.allowedPaths
				.map((path) => `    - ${path}`)
				.join("\n")}`
		: "- Edit only the file(s) implicated by the localized context above.";

	const system = [
		"You are a surgical bug-fixing patch generator inside a constrained repair pipeline.",
		`Produce EXACTLY ${count} ${plural} for the bug described. Each candidate must be a genuinely DIFFERENT approach`,
		"to the fix, not a trivial re-wording of another — the pipeline validates and ranks them against each other.",
		"",
		"Output format (STRICT — anything else is discarded):",
		"- Emit each candidate as its own fenced code block opened with ```diff and closed with ```.",
		"- Inside each block, use unified-diff format: a `diff --git a/<path> b/<path>` header, `--- a/<path>` and",
		"  `+++ b/<path>` file headers, and `@@ … @@` hunk headers with `+`/`-` lines.",
		scopeRule,
		"- Emit NOTHING outside the fenced diff blocks — no prose, no explanation, no numbering.",
	].join("\n");

	const user = [
		"## Bug to fix",
		input.bugSummary.trim(),
		"",
		"## Localized fault context",
		renderContext(input.localizedContext),
		"",
		`## Task`,
		`Return ${count} ${plural}, each in its own \`\`\`diff block, following the strict output format.`,
	].join("\n");

	return { system, user };
}
