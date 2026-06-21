import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildCompressedContextPreview,
	compressKanbanContextText,
	compressKanbanContextTextWithProvider,
	createNKleinModelCompressionProvider,
} from "../../../src/nklein-sdk/nklein-context-compression";

describe("nklein context compression", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("uses caveman-style compression for prose-heavy context", () => {
		const result = compressKanbanContextText(
			"The implementation should preserve the existing behavior and the tests should explain the regression.",
			{ maxTokens: 80 },
		);

		expect(result.mode).toBe("prose_caveman");
		expect(result.compressedTokens).toBeLessThan(result.originalTokens);
		expect(result.text).toContain("implementation");
		expect(result.text).toContain("regression");
	});

	it("uses code minification rather than token pruning for code-like context", () => {
		const result = compressKanbanContextText(
			[
				"export function calculateScore(value: number): number {",
				"  // Keep this code structurally valid enough for inspection.",
				"  const bounded = Math.max(0, value);",
				"  return bounded;",
				"}",
			].join("\n"),
			{ maxTokens: 100 },
		);

		expect(result.mode).toBe("code_minify");
		expect(result.text).toContain("calculateScore");
		expect(result.text).not.toContain("Keep this code structurally");
	});

	it("falls back to deterministic compression until a safe provider is wired", () => {
		const result = compressKanbanContextText("Important facts must not be silently model-compressed.", {
			maxTokens: 20,
			allowModelAssisted: true,
		});

		expect(result.mode).toBe("prose_caveman");
		expect(buildCompressedContextPreview("The user wants careful compression.", 40)).toContain(
			"older text compressed",
		);
	});

	it("uses a gated OpenAI-compatible provider for model-assisted compression", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				choices: [{ message: { content: "Preserve requirements; reduce repeated prose." } }],
			}),
		})) as unknown as typeof fetch;
		globalThis.fetch = fetchMock;
		const provider = createNKleinModelCompressionProvider({
			KANBAN_CONTEXT_COMPRESSION_PROVIDER: "openai-compatible",
			KANBAN_CONTEXT_COMPRESSION_EVAL_PROOF: "1",
			KANBAN_CONTEXT_COMPRESSION_BASE_URL: "https://compress.example/v1/chat/completions",
			KANBAN_CONTEXT_COMPRESSION_MODEL: "compression-model",
			KANBAN_CONTEXT_COMPRESSION_API_KEY: "secret",
		});

		const result = await compressKanbanContextTextWithProvider("Preserve every requirement and reduce prose.", {
			maxTokens: 40,
			provider,
		});

		expect(result.mode).toBe("model_assisted");
		expect(result.provider).toBe("openai_compatible:compression-model");
		expect(result.text).toContain("requirements");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://compress.example/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					authorization: "Bearer secret",
				}),
			}),
		);
	});
});
