import type { ReactElement } from "react";

/**
 * The single sanctioned `dangerouslySetInnerHTML` sink in web-ui.
 *
 * Callers MUST pass HTML produced by `Prism.highlight()`, which HTML-escapes its source text (only Prism's own
 * `<span>` token markup is emitted raw), so the injected output is XSS-safe even for untrusted code/diff content.
 * Keeping the one exception here — rather than scattered across call sites — means there is exactly one place to
 * audit, and the `noDangerouslySetInnerHtml` lint rule stays enforced everywhere else.
 */
export function PrismHtml({
	html,
	as = "span",
	className,
}: {
	html: string;
	as?: "span" | "code";
	className?: string;
}): ReactElement {
	const Tag = as;
	// biome-ignore lint/security/noDangerouslySetInnerHtml: Prism-escaped highlight HTML only — see the contract above.
	return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
