/**
 * Build the seed prompt for a "/nklein-ts self-improvement" task, extracted from projects-api. Pure.
 *
 * Always states the source checkout, the standing driver/guardrails, and the acceptance criteria;
 * optionally appends an Evidence section (when an evidence bundle path is given) and a User notes
 * section (when notes are given). Blank/whitespace-only evidence/notes are omitted.
 */
export function buildSelfImprovementTaskPrompt(input: {
	workspacePath: string;
	notes?: string | null;
	evidenceBundlePath?: string | null;
}): string {
	const lines = [
		"/nklein-ts",
		"",
		"Improve !Klein using the currently running development checkout.",
		"",
		"Source:",
		`- Current dev checkout: ${input.workspacePath}`,
		"",
		"Main driver:",
		"- Keep improving support for small local LLMs on limited hardware.",
		"- Preserve the local-only, forward-moving fork direction.",
		"- Keep protected-test guardrails intact; do not weaken protected tests without explicit human approval.",
	];
	if (input.evidenceBundlePath?.trim()) {
		lines.push("", "Evidence:", `- Bundle: ${input.evidenceBundlePath.trim()}`);
	}
	if (input.notes?.trim()) {
		lines.push("", "User notes:", input.notes.trim());
	}
	lines.push(
		"",
		"Acceptance:",
		"- Make the smallest coherent improvement that addresses the evidence or notes.",
		"- Add or update focused tests.",
		"- Run the relevant focused checks and report exact commands/results.",
	);
	return lines.join("\n");
}
