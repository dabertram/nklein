/**
 * Live cache-health verification (§5.AQ) — the EFFECTFUL TTFT double-prefix probe behind `src/core/cache-health.ts`.
 *
 * Sends a long, UNIQUE-nonced prefix to a real local model multiple times (warmup → cold → warm → warm), times the
 * time-to-first-token each send, and runs the real {@link classifyCacheHealth} interpreter. A reused prefix KV cache
 * makes the warm TTFT collapse (≥3-5× speedup); if the engine silently recomputes the prefix (a genuinely cache-broken
 * format, e.g. MLX GPT-OSS-20B / #1697) the two TTFTs are ~equal. This MEASURES the actual effect — the most trustworthy
 * signal (LM Studio's `cached_tokens` is unreliable, #778).
 *
 * It reports a VERDICT (healthy/unhealthy) — both are valid findings; it exits non-zero only if the timings were
 * UNMEASURABLE (e.g. a too-slow model timed out before the first token). Empirically (2026-06-30) qwen3.5-MLX caches
 * fine (71.7×) despite the arch pre-filter flagging it — so this probe is the authority, not the static arch guess.
 *
 * Run:  tsx scripts/verify-cache-health-live.mts
 *   env: NKLEIN_VERIFY_MODEL (default: first non-embed loaded), NKLEIN_VERIFY_BASE_URL (default :1234/v1),
 *        NKLEIN_VERIFY_PREFIX_LINES (default 130 ≈ ~2k tok), NKLEIN_VERIFY_TIMEOUT_MS (default 240000).
 */
import { classifyCacheHealth } from "../src/core/cache-health";

const BASE_URL = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:1234/v1";
const TIMEOUT_MS = Number(process.env.NKLEIN_VERIFY_TIMEOUT_MS) || 240_000;
const PREFIX_LINES = Number(process.env.NKLEIN_VERIFY_PREFIX_LINES) || 130;

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function resolveModelId(): Promise<string> {
	if (process.env.NKLEIN_VERIFY_MODEL?.trim()) {
		return process.env.NKLEIN_VERIFY_MODEL.trim();
	}
	const res = await fetch(`${BASE_URL}/models`);
	const payload = (await res.json()) as { data?: Array<{ id?: string }> };
	const id = payload.data?.find((e) => !e.id?.includes("embed"))?.id ?? payload.data?.[0]?.id;
	if (!id) {
		throw new Error(`Could not resolve a model id from ${BASE_URL}/models`);
	}
	return id;
}

async function measureTtftMs(model: string, messages: Array<{ role: string; content: string }>): Promise<number> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	const start = performance.now();
	try {
		const res = await fetch(`${BASE_URL}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 2, stream: true }),
			signal: ctrl.signal,
		});
		if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = "";
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			if (/"(content|reasoning_content)"\s*:\s*"[^"]/.test(buf)) {
				const ttft = performance.now() - start;
				await reader.cancel().catch(() => {});
				return ttft;
			}
		}
		return performance.now() - start;
	} catch {
		return Number.NaN; // unmeasurable (timeout/abort) — classifier guards against it
	} finally {
		clearTimeout(timer);
	}
}

async function main(): Promise<void> {
	const model = await resolveModelId();
	const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const longContext = Array.from(
		{ length: PREFIX_LINES },
		(_, i) => `Reference fact ${i} [run ${nonce}]: subsystem ${i} preserves invariant ${(i * 7) % 13} under deterministic ordering.`,
	).join("\n");
	const messages = [
		{ role: "system", content: `You are a careful assistant. Stable reference context:\n${longContext}` },
		{ role: "user", content: "Reply with exactly the single word: ok." },
	];

	log(`Model: ${model}  BaseUrl: ${BASE_URL}  (prefix ${PREFIX_LINES} lines, nonce ${nonce})`);
	await measureTtftMs(model, [{ role: "user", content: "Reply with: ready." }]); // warmup (absorbs lazy init)
	const cold = await measureTtftMs(model, messages);
	const warm1 = await measureTtftMs(model, messages);
	const warm2 = await measureTtftMs(model, messages);
	const fmt = (n: number) => (Number.isFinite(n) ? `${n.toFixed(0)} ms` : "unmeasurable (timeout)");
	log(`cold  TTFT: ${fmt(cold)}`);
	log(`warm1 TTFT: ${fmt(warm1)}`);
	log(`warm2 TTFT: ${fmt(warm2)}`);

	const warm = Math.min(warm1, warm2);
	const verdict = classifyCacheHealth({ coldTtftMs: cold, warmTtftMs: warm });
	log("");
	log("=== §5.AQ cache-health live verification ===");
	log(`speedup (cold/warm): ${verdict.speedup.toFixed(2)}x`);
	log(`verdict: ${verdict.healthy ? "HEALTHY ✓ (prefix KV cache reused)" : "UNHEALTHY ⚠️ (prefix appears recomputed)"}`);
	log(verdict.reason);
	if (verdict.speedup === 0) {
		log("\nUNMEASURABLE — the cold/warm TTFTs were not both positive+finite (model too slow? endpoint down?).");
		process.exit(1);
	}
	process.exit(0);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
