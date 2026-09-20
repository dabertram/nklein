/**
 * `lookup` page-text extraction — PURE. A fetched page is untrusted HTML; the model needs readable text, bounded.
 * No DOM, no browser: scripts/styles/nav chrome are dropped, block tags become line breaks, entities are decoded,
 * whitespace is collapsed, and the result is capped with an explicit truncation note (so the model knows there was
 * more). Plain-text and JSON bodies pass through the same cap.
 */

import { decodeHtmlEntities, INLINE_HTML_TAG } from "./lookup-search-parse";

export const DEFAULT_LOOKUP_PAGE_MAX_CHARS = 8_000;

const DROP_BLOCKS = /<(head|script|style|noscript|svg|iframe|nav|header|footer|form|aside)\b[\s\S]*?<\/\1>/gi;
const BLOCK_BREAK = /<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre|br|dt|dd)>|<br\s*\/?>|<hr\s*\/?>/gi;

export interface ExtractedPageText {
	title: string;
	text: string;
	truncated: boolean;
}

export function extractReadableText(
	body: string,
	options: { contentType?: string | null; maxChars?: number } = {},
): ExtractedPageText {
	const maxChars = options.maxChars ?? DEFAULT_LOOKUP_PAGE_MAX_CHARS;
	const contentType = (options.contentType ?? "").toLowerCase();
	const isHtml = contentType.includes("html") || (!contentType && /<html|<body|<div|<p\b/i.test(body));
	let title = "";
	let text: string;
	if (isHtml) {
		const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
		title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, " ")).trim() : "";
		text = body
			.replace(DROP_BLOCKS, " ")
			.replace(BLOCK_BREAK, "\n")
			.replace(INLINE_HTML_TAG, "")
			.replace(/<[^>]*>/g, " ");
		text = decodeHtmlEntities(text);
	} else {
		text = body;
	}
	const normalized = text
		.split("\n")
		.map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n");
	if (normalized.length <= maxChars) {
		return { title, text: normalized, truncated: false };
	}
	return {
		title,
		text: `${normalized.slice(0, maxChars)}\n[truncated: ${normalized.length - maxChars} more characters]`,
		truncated: true,
	};
}
