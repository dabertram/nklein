export type NKleinCodeEmbeddingProviderKind = "local_lexical" | "openai_compatible";
export interface NKleinCodeEmbeddingSettings {
	provider: NKleinCodeEmbeddingProviderKind;
	model: string | null;
	baseUrl: string | null;
}

export type NKleinCodeEmbeddingVector = Map<string, number>;

export interface NKleinCodeEmbeddingProvider {
	kind: NKleinCodeEmbeddingProviderKind;
	model: string;
	cacheKey: string;
	embed(text: string): Promise<NKleinCodeEmbeddingVector>;
}

interface OpenAiEmbeddingResponse {
	data: Array<{
		embedding: number[];
	}>;
}

export const LOCAL_LEXICAL_CODE_EMBEDDING_MODEL = "kanban-local-lexical-vector-v1";

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function vectorizeSparseTokens(text: string): NKleinCodeEmbeddingVector {
	const vector: NKleinCodeEmbeddingVector = new Map();
	for (const token of tokenize(text)) {
		vector.set(token, (vector.get(token) ?? 0) + 1);
	}
	return vector;
}

function vectorizeDenseEmbedding(embedding: readonly number[]): NKleinCodeEmbeddingVector {
	const vector: NKleinCodeEmbeddingVector = new Map();
	for (const [index, value] of embedding.entries()) {
		if (Number.isFinite(value) && value !== 0) {
			vector.set(`dim:${index}`, value);
		}
	}
	return vector;
}

function readOpenAiEmbeddingResponse(value: unknown): OpenAiEmbeddingResponse | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const data = (value as Record<string, unknown>).data;
	if (!Array.isArray(data)) {
		return null;
	}
	const first = data[0];
	if (!first || typeof first !== "object") {
		return null;
	}
	const embedding = (first as Record<string, unknown>).embedding;
	if (!Array.isArray(embedding) || !embedding.every((entry) => typeof entry === "number")) {
		return null;
	}
	return {
		data: [{ embedding }],
	};
}

function createLocalLexicalEmbeddingProvider(): NKleinCodeEmbeddingProvider {
	return {
		kind: "local_lexical",
		model: LOCAL_LEXICAL_CODE_EMBEDDING_MODEL,
		cacheKey: LOCAL_LEXICAL_CODE_EMBEDDING_MODEL,
		async embed(text) {
			return vectorizeSparseTokens(text);
		},
	};
}

function createOpenAiCompatibleEmbeddingProvider(input: {
	baseUrl: string | null | undefined;
	model: string | null | undefined;
	apiKey?: string | null | undefined;
}): NKleinCodeEmbeddingProvider | null {
	const endpoint = input.baseUrl?.trim();
	const model = input.model?.trim();
	if (!endpoint || !model) {
		return null;
	}
	const apiKey = input.apiKey?.trim();
	return {
		kind: "openai_compatible",
		model,
		cacheKey: `openai-compatible:${endpoint}:${model}`,
		async embed(text) {
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model,
					input: text,
				}),
			});
			if (!response.ok) {
				throw new Error(`Embedding provider failed with HTTP ${response.status}.`);
			}
			const parsed = readOpenAiEmbeddingResponse(await response.json());
			if (!parsed) {
				throw new Error("Embedding provider returned an invalid embedding response.");
			}
			return vectorizeDenseEmbedding(parsed.data[0]?.embedding ?? []);
		},
	};
}

export function createNKleinCodeEmbeddingProvider(env: NodeJS.ProcessEnv = process.env): NKleinCodeEmbeddingProvider {
	if (env.KANBAN_CODE_EMBEDDING_PROVIDER?.trim() === "openai-compatible") {
		return (
			createOpenAiCompatibleEmbeddingProvider({
				baseUrl: env.KANBAN_CODE_EMBEDDING_BASE_URL,
				model: env.KANBAN_CODE_EMBEDDING_MODEL,
				apiKey: env.KANBAN_CODE_EMBEDDING_API_KEY,
			}) ?? createLocalLexicalEmbeddingProvider()
		);
	}
	return createLocalLexicalEmbeddingProvider();
}

export function createNKleinCodeEmbeddingProviderFromSettings(
	settings: NKleinCodeEmbeddingSettings,
	env: NodeJS.ProcessEnv = process.env,
): NKleinCodeEmbeddingProvider {
	if (settings.provider === "openai_compatible") {
		return (
			createOpenAiCompatibleEmbeddingProvider({
				baseUrl: settings.baseUrl,
				model: settings.model,
				apiKey: env.KANBAN_CODE_EMBEDDING_API_KEY,
			}) ?? createLocalLexicalEmbeddingProvider()
		);
	}
	return createLocalLexicalEmbeddingProvider();
}
