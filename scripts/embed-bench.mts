/**
 * Code-embedding throughput benchmark (§5.I #2).
 *
 * Measures the batteries-included dense embedding model (nomic-embed-text-v1.5 Q4_K_M GGUF — the
 * `DEFAULT_EMBEDDING_MODEL_MANIFEST` the `local_gguf` provider downloads) against an OpenAI-compatible
 * embeddings endpoint, plus the in-process `local_lexical` baseline. The corpus is the repo's own
 * TypeScript source split into ~40-line chunks (realistic code-index chunks).
 *
 * It reports single-text latency (matching the real `/v1/embed` one-text-per-call path in
 * `nklein-code-embeddings.ts`), batched throughput, and the lexical baseline — to answer "is the dense
 * model fast enough for indexing, or should dense be a second layer behind the instant lexical pass?"
 *
 * Run (point it at any OpenAI-compatible embeddings server, e.g. LM Studio with the model loaded):
 *   EMBED_BASE_URL=http://127.0.0.1:1234/v1/embeddings \
 *   EMBED_MODEL=text-embedding-nomic-embed-text-v1.5@q4_k_m \
 *   tsx scripts/embed-bench.mts
 */
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";

const BASE_URL = process.env.EMBED_BASE_URL?.trim() || "http://127.0.0.1:1234/v1/embeddings";
const MODEL = process.env.EMBED_MODEL?.trim() || "text-embedding-nomic-embed-text-v1.5@q4_k_m";
const SAMPLE = Number(process.env.EMBED_SAMPLE ?? "200");

async function embed(input: string | string[]): Promise<void> {
	const response = await fetch(BASE_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model: MODEL, input }),
	});
	if (!response.ok) {
		throw new Error(`Embeddings endpoint failed: HTTP ${response.status}`);
	}
	await response.json();
}

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.filter((token) => token.length >= 2);
}

async function collectChunks(limit: number): Promise<string[]> {
	const chunks: string[] = [];
	for await (const path of glob("src/**/*.ts")) {
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch {
			continue;
		}
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i += 40) {
			const chunk = lines.slice(i, i + 40).join("\n").trim();
			if (chunk.length >= 80) {
				chunks.push(chunk.slice(0, 2000));
			}
		}
		if (chunks.length >= limit) {
			break;
		}
	}
	return chunks.slice(0, limit);
}

function percentile(sorted: number[], p: number): number {
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

async function main(): Promise<void> {
	const chunks = await collectChunks(Math.max(SAMPLE + 50, 250));
	const avg = Math.round(chunks.reduce((sum, c) => sum + c.length, 0) / chunks.length);
	console.log(`Model: ${MODEL}\nEndpoint: ${BASE_URL}`);
	console.log(`Corpus: ${chunks.length} code chunks, avg ${avg} chars`);

	for (const chunk of chunks.slice(0, 5)) {
		await embed(chunk); // warm-up
	}

	const n = Math.min(SAMPLE, chunks.length);
	const times: number[] = [];
	let start = performance.now();
	for (const chunk of chunks.slice(0, n)) {
		const s = performance.now();
		await embed(chunk);
		times.push(performance.now() - s);
	}
	let wall = (performance.now() - start) / 1000;
	times.sort((a, b) => a - b);
	console.log(`\n=== Sequential (batch=1, the current local_gguf path) ===`);
	console.log(`  ${n} texts in ${wall.toFixed(2)}s -> ${(n / wall).toFixed(1)} texts/sec`);
	console.log(
		`  per-text: p50=${percentile(times, 0.5).toFixed(1)}ms p95=${percentile(times, 0.95).toFixed(1)}ms`,
	);

	for (const batchSize of [16, 64]) {
		start = performance.now();
		let total = 0;
		for (let i = 0; i < n; i += batchSize) {
			const batch = chunks.slice(i, i + batchSize);
			await embed(batch);
			total += batch.length;
		}
		wall = (performance.now() - start) / 1000;
		console.log(`\n=== Batched (batch=${batchSize}) ===`);
		console.log(`  ${total} texts in ${wall.toFixed(2)}s -> ${(total / wall).toFixed(1)} texts/sec`);
	}

	start = performance.now();
	for (const chunk of chunks.slice(0, n)) {
		const vector = new Map<string, number>();
		for (const token of tokenize(chunk)) {
			vector.set(token, (vector.get(token) ?? 0) + 1);
		}
	}
	wall = (performance.now() - start) / 1000;
	console.log(`\n=== Lexical baseline (in-process sparse tokens, no model) ===`);
	console.log(`  ${n} texts in ${(wall * 1000).toFixed(1)}ms -> ${Math.round(n / wall).toLocaleString()} texts/sec`);
}

main().catch((error) => {
	console.error(`FATAL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.exit(1);
});
