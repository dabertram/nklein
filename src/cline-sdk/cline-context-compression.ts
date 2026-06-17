import { countKanbanTextTokens } from "./cline-context-budgets";

export type ClineContextCompressionMode = "prose_caveman" | "code_minify" | "model_assisted_disabled";

export interface ClineContextCompressionResult {
	mode: ClineContextCompressionMode;
	originalTokens: number;
	compressedTokens: number;
	text: string;
}

const PROSE_STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"be",
	"been",
	"being",
	"but",
	"by",
	"for",
	"from",
	"has",
	"have",
	"in",
	"into",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"to",
	"was",
	"were",
	"with",
]);

function looksLikeCode(text: string): boolean {
	const codeSignals = (text.match(/[{};=<>()[\]]/g) ?? []).length;
	const lineCount = text.split("\n").length;
	const importExportSignals = (text.match(/\b(?:import|export|function|class|interface|const|let|var)\b/g) ?? [])
		.length;
	return codeSignals >= 8 || importExportSignals >= 2 || (lineCount >= 6 && codeSignals >= 4);
}

function compressProseCaveman(text: string): string {
	return text
		.split("\n")
		.map((line) =>
			line
				.replace(/\s+/g, " ")
				.trim()
				.split(" ")
				.filter((word) => {
					const normalized = word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
					return normalized.length === 0 || !PROSE_STOP_WORDS.has(normalized);
				})
				.join(" "),
		)
		.filter((line) => line.length > 0)
		.join("\n");
}

function stripInlineCodeComment(line: string): string {
	const commentIndex = line.indexOf("//");
	if (commentIndex < 0) {
		return line;
	}
	const before = line.slice(0, commentIndex);
	const quoteCount = (before.match(/["'`]/g) ?? []).length;
	return quoteCount % 2 === 0 ? before : line;
}

function compressCodeMinify(text: string): string {
	return text
		.split("\n")
		.map((line) => stripInlineCodeComment(line).trim())
		.filter((line) => line.length > 0 && !line.startsWith("/*") && !line.startsWith("*") && !line.startsWith("*/"))
		.join("\n");
}

function trimToTokenBudget(text: string, maxTokens: number): string {
	let trimmed = text.trim();
	while (trimmed.length > 1 && countKanbanTextTokens(trimmed) > maxTokens) {
		trimmed = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length * 0.82))).trimEnd();
	}
	return trimmed;
}

export function compressKanbanContextText(
	text: string,
	options: {
		maxTokens: number;
		allowModelAssisted?: boolean;
	} = { maxTokens: 200 },
): ClineContextCompressionResult {
	const originalTokens = countKanbanTextTokens(text);
	if (options.allowModelAssisted) {
		const compressed = trimToTokenBudget(text, options.maxTokens);
		return {
			mode: "model_assisted_disabled",
			originalTokens,
			compressedTokens: countKanbanTextTokens(compressed),
			text: compressed,
		};
	}

	const mode: ClineContextCompressionMode = looksLikeCode(text) ? "code_minify" : "prose_caveman";
	const candidate = mode === "code_minify" ? compressCodeMinify(text) : compressProseCaveman(text);
	const compressed = trimToTokenBudget(candidate.length > 0 ? candidate : text, options.maxTokens);
	return {
		mode,
		originalTokens,
		compressedTokens: countKanbanTextTokens(compressed),
		text: compressed,
	};
}

export function buildCompressedContextPreview(text: string, maxTokens: number): string {
	const compressed = compressKanbanContextText(text, { maxTokens });
	return [
		`[Kanban context focus: older text compressed with ${compressed.mode}; ${compressed.originalTokens} -> ${compressed.compressedTokens} tokens.]`,
		compressed.text,
	].join(" ");
}
