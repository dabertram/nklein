/**
 * Cache-friendliness PRE-filter from the model id (todo §5.AQ item E) — a cheap, pure heuristic that classifies a
 * model's ATTENTION ARCHITECTURE from its id so callers can SKIP the expensive live probe for ids that are known to be
 * cache-broken (or known-good) by architecture alone. The authoritative signal is still the TTFT double-prefix probe in
 * the sibling `cache-health.ts` ({@link classifyCacheHealth}); this module only NARROWS the candidate set — it never
 * overrides the probe.
 *
 * Why architecture decides it: prefix KV-cache reuse only works on PURE full-attention models. **Sliding-window
 * attention (SWA) and SSM/Mamba (and other mixed/hybrid attention) silently fall back to a full re-prefill** — the
 * single biggest local-inference speed regression (~5s cached vs ~200s uncached at 40k context), and it surfaces in NO
 * API field. Concretely: LM Studio #1697 has MLX GPT-OSS-20B broken; mlx-lm #980 lists Qwen3.5 / GPT-OSS / Gemma3 /
 * Llama4 as affected; llama.cpp #20225 / #19794 / #21468 track Qwen3.5 / Qwen3-Coder / Gemma4. Gemma 3/4 use SWA;
 * Qwen3.5/3.6, Falcon-H1, Jamba and Mamba are SSM-hybrids; Llama/Mistral/Mixtral/Qwen2.5/Phi-3/4/MiniMax are pure
 * full-attention.
 *
 * **EMPIRICAL CAVEAT (2026-06-30 live TTFT probe — TWO arch families).** Despite the "affected" lists, both hybrid arches
 * tested cache PERFECTLY in the current LM Studio MLX engine: `qwopus3.6-27b-v2-mlx` (qwen3.5 SSM-hybrid) → 71.7× warm/cold
 * speedup, and `gemma-4-e4b` (Gemma SWA, llama.cpp #21468 list) → 116.8× — both HEALTHY cache hits. So the mlx-lm #980 /
 * llama.cpp "affected" lists are per-`(engine,model,version)` and largely fixed, NOT a blanket arch property, and `#1697`'s
 * failure is GPT-OSS-specific. Treat a non-`full_attention` result here as a WEAK PRIOR only: it may be used to PRIORITIZE
 * the live probe, but NEVER to SKIP it and assume broken (that would false-positive models like these that cache fine). The
 * `classifyCacheHealth` probe in `cache-health.ts` is the sole authority for a cache-broken verdict.
 *
 * MoE-NESS DOES NOT MATTER: a plain Mixture-of-Experts model caches fine as long as its attention is full (MiniMax
 * M2.5 = full attention + MoE, and it caches). So {@link ModelArchHint.isMoe} is accepted (and may inform other
 * heuristics) but is intentionally IGNORED by {@link classifyAttentionArchitecture} — it never flips the verdict.
 *
 * Bias toward the SAFE answer: when an id matches more than one family the more-broken verdict wins
 * (`hybrid_ssm` > `hybrid_swa` > `full_attention`), and an UNRECOGNISED id is `"unknown"` → treated as NOT
 * cache-friendly so the caller falls back to the live probe rather than assuming reuse works. The module is pure +
 * deterministic: it only lowercases + substring-matches the id and performs no I/O.
 */

/**
 * The attention architecture family relevant to prefix-cache reuse.
 * - `full_attention` — pure full attention; prefix KV cache is reused (MoE on top is fine).
 * - `hybrid_swa` — sliding-window attention (e.g. GPT-OSS, Gemma 3/4); silently recomputes the prefix.
 * - `hybrid_ssm` — SSM/Mamba-hybrid (e.g. Qwen3.5/3.6, Falcon-H1, Jamba); silently recomputes the prefix.
 * - `unknown` — id not recognised; treat conservatively and confirm with the live TTFT probe.
 */
export type AttentionArch = "full_attention" | "hybrid_swa" | "hybrid_ssm" | "unknown";

/** What this PRE-filter needs about a model: its id, plus an optional MoE flag (accepted but NOT used for the verdict). */
export interface ModelArchHint {
	/** The model id / name as the runtime reports it (e.g. `"qwen3.5-30b-a3b"`, `"gpt-oss-20b"`). Matched case-insensitively. */
	modelId: string;
	/** Whether the model is a Mixture-of-Experts. Plain MoE does NOT break prefix caching, so this never flips the verdict. */
	isMoe?: boolean;
}

/** A family of id substrings that all map to one architecture verdict. */
interface ArchSignature {
	arch: AttentionArch;
	/** Lowercase substrings; if the lowercased model id contains ANY of these, this signature matches. */
	patterns: readonly string[];
}

// Checked IN ORDER, most-broken first, so when an id matches multiple families the safer (broken-cache) verdict wins:
// hybrid_ssm > hybrid_swa > full_attention. Each pattern is matched as a plain lowercase substring of the model id.
const ARCH_SIGNATURES: readonly ArchSignature[] = [
	{
		// SSM / Mamba hybrids — attention is mixed with state-space layers, so prefix KV reuse silently breaks.
		// Qwen3.5/3.6 (and its underscore/dash spellings), Falcon-H1, Jamba, Mamba, and the generic "ssm" marker.
		arch: "hybrid_ssm",
		patterns: ["qwen3.5", "qwen-3.5", "qwen3_5", "qwen3.6", "falcon-h1", "falconh1", "jamba", "mamba", "ssm"],
	},
	{
		// Sliding-window attention — GPT-OSS and Gemma 3/4 use SWA, which falls back to a full re-prefill.
		arch: "hybrid_swa",
		patterns: ["gpt-oss", "gptoss", "gemma-3", "gemma3", "gemma-4", "gemma4"],
	},
	{
		// Pure full attention — prefix KV cache is reused. MiniMax is full-attention + MoE and caches fine.
		arch: "full_attention",
		patterns: ["llama", "mistral", "mixtral", "qwen2.5", "qwen-2.5", "minimax", "phi-3", "phi3", "phi-4", "phi4"],
	},
];

/**
 * Classify a model's attention architecture from its id (todo §5.AQ item E PRE-filter). Lowercases the id and
 * substring-matches the known families in {@link ARCH_SIGNATURES}, which are ordered most-broken-first so that an id
 * matching several families gets the SAFER (more cache-broken) verdict: `hybrid_ssm` > `hybrid_swa` > `full_attention`.
 *
 * {@link ModelArchHint.isMoe} is intentionally ignored — plain MoE does not break prefix caching (MiniMax M2.5 is
 * full-attention + MoE and caches), so it must never flip the verdict. An id matching no known family is `"unknown"`,
 * which {@link isLikelyCacheFriendly} treats conservatively (confirm with the live probe). Pure — no I/O.
 */
export function classifyAttentionArchitecture(hint: ModelArchHint): AttentionArch {
	const id = hint.modelId.toLowerCase();
	for (const signature of ARCH_SIGNATURES) {
		if (signature.patterns.some((pattern) => id.includes(pattern))) {
			return signature.arch;
		}
	}
	return "unknown";
}

/**
 * Whether a model is LIKELY to reuse its prefix KV cache, given its architecture. True ONLY for `"full_attention"`;
 * `"hybrid_swa"` and `"hybrid_ssm"` silently recompute the prefix → `false`; `"unknown"` → `false` as well
 * (conservative: don't assume reuse for an id we can't classify — let the live TTFT probe in `cache-health.ts` confirm).
 *
 * This is a PRE-filter only: a `true` here means "probably skip the probe / safe to assume caching"; a `false` means
 * "don't trust the cache — probe before relying on prefix reuse, or reserve this model for short one-shot calls."
 */
export function isLikelyCacheFriendly(arch: AttentionArch): boolean {
	return arch === "full_attention";
}
