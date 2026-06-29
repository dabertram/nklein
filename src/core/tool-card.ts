/**
 * ToolCard: deliberately SHORT descriptor of one tool, shown to small models so a long verbose tool schema
 * doesn't blow their context / confuse them. Tied to §5.O (small-model output robustness).
 *
 * A ToolCard is a lightweight tool interface for small models: name, one-line purpose, when/when-not to use,
 * and a terse argument hint. Replaces verbose tool schemas when context is tight or model capability is limited.
 */

export interface ToolCard {
	/** Tool name (e.g., "read_file", "git_commit"). */
	name: string;

	/** One-line purpose (e.g., "Read file contents"). */
	purpose: string;

	/** When to reach for this tool (e.g., "When you need to examine code before editing"). */
	useWhen: string;

	/** Terse argument hint (e.g., "path: file path"). Optional. */
	args?: string;

	/** When NOT to use this tool (anti-pattern, e.g., "Avoid reading files > 100KB without pagination"). Optional. */
	avoidWhen?: string;
}

/**
 * Render a single ToolCard as a compact, token-frugal block. Each field appears on its own line, in order:
 * name, purpose, use-when, args (if present), avoid-when (if present). Omits absent optional fields.
 */
export function renderToolCard(card: ToolCard): string {
	const lines: string[] = [];

	lines.push(`${card.name}`);
	lines.push(`  ${card.purpose}`);
	lines.push(`  Use when: ${card.useWhen}`);

	if (card.args) {
		lines.push(`  Args: ${card.args}`);
	}

	if (card.avoidWhen) {
		lines.push(`  Avoid: ${card.avoidWhen}`);
	}

	return lines.join("\n");
}

/**
 * Render a list of ToolCards joined by a blank line (stable order). Returns an empty string if the list is empty.
 */
export function renderToolCardList(cards: readonly ToolCard[]): string {
	if (cards.length === 0) {
		return "";
	}

	return cards.map(renderToolCard).join("\n\n");
}
