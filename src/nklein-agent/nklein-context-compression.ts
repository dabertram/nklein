import { isTruthyEnv } from "../core/env-flag";
import { countKanbanTextTokens } from "./nklein-context-budgets";
import { compressByTokenImportance, type TokenImportanceScorer } from "./nklein-prompt-compression";

export type NKleinContextCompressionMode = "prose_caveman" | "code_minify" | "model_assisted" | "selective";

export interface NKleinContextCompressionResult {
	mode: NKleinContextCompressionMode;
	originalTokens: number;
	compressedTokens: number;
	text: string;
	provider?: string;
}

export interface NKleinModelCompressionProvider {
	name: string;
	model: string;
	compress(input: { text: string; maxTokens: number; contentKind: "code" | "prose" }): Promise<string>;
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

function readOpenAiChatText(value: unknown): string | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const outputText = record.output_text;
	if (typeof outputText === "string") {
		return outputText;
	}
	const choices = record.choices;
	if (!Array.isArray(choices)) {
		return null;
	}
	const first = choices[0];
	if (!first || typeof first !== "object") {
		return null;
	}
	const message = (first as Record<string, unknown>).message;
	if (!message || typeof message !== "object") {
		return null;
	}
	const content = (message as Record<string, unknown>).content;
	return typeof content === "string" ? content : null;
}

export function createNKleinModelCompressionProvider(
	env: NodeJS.ProcessEnv = process.env,
): NKleinModelCompressionProvider | null {
	if (env.KANBAN_CONTEXT_COMPRESSION_PROVIDER?.trim() !== "openai-compatible") {
		return null;
	}
	if (!isTruthyEnv(env.KANBAN_CONTEXT_COMPRESSION_EVAL_PROOF)) {
		return null;
	}
	const endpoint = env.KANBAN_CONTEXT_COMPRESSION_BASE_URL?.trim();
	const model = env.KANBAN_CONTEXT_COMPRESSION_MODEL?.trim();
	if (!endpoint || !model) {
		return null;
	}
	const apiKey = env.KANBAN_CONTEXT_COMPRESSION_API_KEY?.trim();
	return {
		name: "openai_compatible",
		model,
		async compress(input) {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "system",
							content:
								input.contentKind === "code"
									? "Compress code context safely. Preserve identifiers, paths, signatures, error text, and behavior. Do not invent facts."
									: "Compress prose context safely. Preserve requirements, decisions, constraints, paths, numbers, and open questions. Do not invent facts.",
						},
						{
							role: "user",
							content: `Target <= ${input.maxTokens} tokens.\n\n${input.text}`,
						},
					],
				}),
			});
			if (!response.ok) {
				throw new Error(`Context compression provider failed with HTTP ${response.status}.`);
			}
			const text = readOpenAiChatText(await response.json());
			if (!text) {
				throw new Error("Context compression provider returned no text.");
			}
			return text;
		},
	};
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
	// Scan left-to-right tracking string state, so a `//` INSIDE a string literal (a URL like "https://…", a
	// regex, a protocol string) is never mistaken for the comment. The prior indexOf("//") + quote-parity-before
	// heuristic located the `//` inside such a string and then, seeing an odd quote count before it, wrongly kept
	// the WHOLE line — so the real trailing comment survived into the minified output.
	let stringDelimiter: string | null = null;
	let escaping = false;
	for (let i = 0; i < line.length; i += 1) {
		const char = line[i];
		if (stringDelimiter !== null) {
			if (escaping) {
				escaping = false;
			} else if (char === "\\") {
				escaping = true;
			} else if (char === stringDelimiter) {
				stringDelimiter = null;
			}
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			stringDelimiter = char;
		} else if (char === "/" && line[i + 1] === "/") {
			return line.slice(0, i);
		}
	}
	return line;
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
		/** Opt-in LLMLingua-2-style token-importance compression before trimming (better retention). */
		selective?: boolean;
		/** Optional importance scorer (e.g. an ONNX model); defaults to the heuristic scorer. */
		selectiveScorer?: TokenImportanceScorer;
	} = { maxTokens: 200 },
): NKleinContextCompressionResult {
	const originalTokens = countKanbanTextTokens(text);
	if (options.selective && originalTokens > options.maxTokens && originalTokens > 0) {
		// Keep the most informative tokens first (so trimming discards less meaning), then enforce the budget.
		const targetRatio = Math.min(1, Math.max(0.1, options.maxTokens / originalTokens));
		const selective = compressByTokenImportance(text, { targetRatio, scorer: options.selectiveScorer });
		const compressed = trimToTokenBudget(
			selective.compressed.length > 0 ? selective.compressed : text,
			options.maxTokens,
		);
		return {
			mode: "selective",
			originalTokens,
			compressedTokens: countKanbanTextTokens(compressed),
			text: compressed,
		};
	}
	const mode: NKleinContextCompressionMode = looksLikeCode(text) ? "code_minify" : "prose_caveman";
	const candidate = mode === "code_minify" ? compressCodeMinify(text) : compressProseCaveman(text);
	const compressed = trimToTokenBudget(candidate.length > 0 ? candidate : text, options.maxTokens);
	return {
		mode,
		originalTokens,
		compressedTokens: countKanbanTextTokens(compressed),
		text: compressed,
	};
}

export async function compressKanbanContextTextWithProvider(
	text: string,
	options: {
		maxTokens: number;
		provider?: NKleinModelCompressionProvider | null;
	} = { maxTokens: 200 },
): Promise<NKleinContextCompressionResult> {
	const provider = options.provider ?? createNKleinModelCompressionProvider();
	if (!provider) {
		return compressKanbanContextText(text, { maxTokens: options.maxTokens });
	}
	const originalTokens = countKanbanTextTokens(text);
	const contentKind = looksLikeCode(text) ? "code" : "prose";
	const providerText = await provider.compress({
		text,
		maxTokens: options.maxTokens,
		contentKind,
	});
	const compressed = trimToTokenBudget(providerText, options.maxTokens);
	return {
		mode: "model_assisted",
		provider: `${provider.name}:${provider.model}`,
		originalTokens,
		compressedTokens: countKanbanTextTokens(compressed),
		text: compressed,
	};
}

export function buildCompressedContextPreview(text: string, maxTokens: number): string {
	const compressed = compressKanbanContextText(text, { maxTokens });
	return [
		`[!Klein context focus: older text compressed with ${compressed.mode}; ${compressed.originalTokens} -> ${compressed.compressedTokens} tokens.]`,
		compressed.text,
	].join(" ");
}

export async function buildCompressedContextPreviewWithProvider(text: string, maxTokens: number): Promise<string> {
	const compressed = await compressKanbanContextTextWithProvider(text, { maxTokens });
	return [
		`[!Klein context focus: older text compressed with ${compressed.mode}${compressed.provider ? ` via ${compressed.provider}` : ""}; ${compressed.originalTokens} -> ${compressed.compressedTokens} tokens.]`,
		compressed.text,
	].join(" ");
}
