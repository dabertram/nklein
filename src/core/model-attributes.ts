/**
 * §5.AB-(B) — pure, deterministic parsing of a model's OBSERVABLE ATTRIBUTES (FORMAT + QUANT + size) from its served
 * id / `lms ls` key. TODAY we never systematically parse a model's format (mlx/gguf) or quant (q4/q8/…) — every surface
 * that needs it either hand-declares it (`swarm-roster.ts`), reads a pre-populated field (`cache-friendly-route.ts`
 * `v.format`), or THROWS the tokens away (`llmfit-capability-prior.ts` `normalizeModelNameForMatch` strips
 * quant/format to fuzzy-match). `model-fitness-freshness.ts` even carries a `quant?` fingerprint input but has no way
 * to DERIVE it — it is set ad-hoc. This is the missing detection primitive that closes that gap (user 2026-07-01).
 *
 * WHY: format+quant are the axes of the future q4-vs-q8 capability drill-down and of optimizing quant against context
 * (user 2026-07-01) — the same measurement at `@4bit` vs `@8bit` is a different subject, and the auto-assigner will want
 * to prefer a heavier quant when the context budget allows. This primitive is what lets any of that key off the id
 * instead of a hand-maintained table, and it is the natural source for the `model-fitness-freshness` quant fingerprint.
 *
 * OWED FOLLOW-UP (deliberately NOT done here, per the §5.AB-(B) scope): this module is intentionally not wired anywhere
 * and adds no catalog/registry fields. A separate card should feed `parseModelAttributes(...).quant` into the
 * {@link ModelFitnessFingerprint} construction and surface format/quant on the model catalog.
 *
 * Total + pure: never throws, does no I/O, reads no clock. Any attribute that cannot be read UNAMBIGUOUSLY is left
 * `undefined` (or `"unknown"` for `format`) — the contract is "conservative, no over-inference": we only claim a format
 * from an explicit `mlx`/`gguf` token (a bare `qN_k_m` or `@Nbit` alias is NOT enough to assert gguf-vs-mlx), and we
 * only claim a size from a standalone `NNb` token, never from an MoE `e4b`/`a3b`/`a10b` (effective/active-params) token.
 */

/** The observable attributes parsed from a model id. Absent/ambiguous fields are `undefined` (`"unknown"` for format). */
export interface ModelAttributes {
	/**
	 * Serving/quantization FORMAT inferred from an explicit token in the id: an `mlx` token ⇒ `"mlx"`, a `gguf` token ⇒
	 * `"gguf"`. Deliberately `"unknown"` when neither is present — a bare `@4bit`/`@8bit` alias or a `qN_k_m` quant token
	 * is NOT treated as proof of format (LM Studio MLX commonly uses `@Nbit` and GGUF commonly uses `qN_k_m`, but the id
	 * alone is ambiguous enough that we do not over-infer). Never `undefined`; always one of the three.
	 */
	format: "mlx" | "gguf" | "unknown";
	/**
	 * NORMALIZED quantization label if the id carries one, else `undefined`. Normalization: an `@Nbit` alias → `"Nbit"`
	 * (e.g. `@4bit` → `4bit`); a GGUF-style token → lowercased with `_` separators (e.g. `Q6_K` → `q6_k`,
	 * `q4-k-xl` → `q4_k_xl`, `q8_0` → `q8_0`). No quant token ⇒ `undefined`.
	 */
	quant?: string;
	/**
	 * Parameter count in billions if the id carries an UNAMBIGUOUS standalone `NNb`/`NNB` size token (e.g. `-4b-` → 4,
	 * `-27b-` → 27, `122b` → 122), else `undefined`. MoE tokens where a letter abuts the digits — `e4b` (Gemma-3n
	 * effective params), `a3b`/`a10b` (active params) — are NOT sizes and are rejected (a digit must not be preceded by
	 * a letter). Fractional sizes (`1.5b`) are supported.
	 */
	paramB?: number;
}

/**
 * `@Nbit` alias quant (LM Studio MLX instance suffix), e.g. `@4bit`, `@8bit`, `@16bit`. Anchored so it only matches the
 * numeric-bit form, not a full `@q8_0` (that is handled by the GGUF matcher below).
 */
const BIT_ALIAS_QUANT = /@(\d{1,2})bit\b/i;

/**
 * GGUF-style quant token, e.g. `q4_k_m`, `q4-k-xl`, `q8_0`, `Q6_K`, `iq3_xxs`, `q5_k_s`. Requires `qN` (optionally
 * `iqN`) optionally followed by `_`/`-`-separated sub-tokens drawn from the CLOSED GGUF quant vocabulary
 * (`k`, `s`/`m`/`l`, `xs`/`xl`/`xxs`/`xxl`, `0`/`1`, unsloth's `ud`). Bounding the continuation to that vocabulary (not
 * "any alnum group") is what stops the token from greedily swallowing a trailing machine tag or format token — e.g.
 * `...-q4-k-xl-legion5pro` must yield `q4_k_xl` (not `q4_k_xl_legion5pro`) and `...-q4_k_m-gguf` must yield `q4_k_m`.
 * Bounded on the left by a non-alphanumeric (or start) so it does not fire inside an unrelated word; the whole quant
 * token is captured and normalized separately.
 */
const GGUF_QUANT = /(?:^|[^a-z0-9])(i?q\d(?:[_-](?:k|s|m|l|xs|xl|xxs|xxl|ud|[01]))*)\b/i;

/** Explicit MLX format token: `mlx-`, `-mlx`, `.mlx`, `@mlx`, or a bare boundary-delimited `mlx`. */
const MLX_FORMAT = /(?:^|[^a-z0-9])mlx(?:$|[^a-z0-9])/i;

/** Explicit GGUF format token: `gguf-`, `-gguf`, `.gguf`, etc. */
const GGUF_FORMAT = /(?:^|[^a-z0-9])gguf(?:$|[^a-z0-9])/i;

/**
 * Standalone parameter-size token `NNb`/`NNB` (e.g. `4b`, `27b`, `122b`, `1.5b`). The digit run must NOT be preceded by
 * a letter, which rejects MoE tokens like `e4b` (effective params) and `a3b`/`a10b` (active params) — those are not the
 * model's total size and must not be read as one. A `.` before the digits (fractional size) is allowed.
 */
const PARAM_SIZE = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)b(?:$|[^a-z0-9])/i;

/**
 * Parse the observable {@link ModelAttributes} (format, quant, param size) from a served model id / `lms ls` key.
 *
 * PURE + TOTAL: never throws, no I/O, no clock. Unrecognized/ambiguous fields are left `undefined`
 * (`format` is `"unknown"` rather than `undefined`). See {@link ModelAttributes} for the per-field contract and the
 * conservative "no over-inference" stance (format only from an explicit `mlx`/`gguf` token; size only from a standalone
 * `NNb` token, never an MoE `e4b`/`a3b` token).
 *
 * @example parseModelAttributes("phi-4-mini-instruct@4bit")            // { format: "unknown", quant: "4bit", paramB: 4 }
 * @example parseModelAttributes("ornith-1.0-35b-mlx@4bit")             // { format: "mlx", quant: "4bit", paramB: 35 }
 * @example parseModelAttributes("qwen3.5-9b-mtp-q4-k-xl-legion5pro")   // { format: "unknown", quant: "q4_k_xl", paramB: 9 }
 * @example parseModelAttributes("qwen2.5-coder-14b")                   // { format: "unknown", paramB: 14 }
 */
export function parseModelAttributes(modelId: string): ModelAttributes {
	const id = typeof modelId === "string" ? modelId.trim() : "";

	return {
		format: parseFormat(id),
		quant: parseQuant(id),
		paramB: parseParamB(id),
	};
}

/** Format from an explicit `mlx`/`gguf` token only; `"unknown"` otherwise (see the field contract — no over-inference). */
function parseFormat(id: string): "mlx" | "gguf" | "unknown" {
	if (MLX_FORMAT.test(id)) {
		return "mlx";
	}
	if (GGUF_FORMAT.test(id)) {
		return "gguf";
	}
	return "unknown";
}

/** Normalized quant label, or `undefined`. `@Nbit` alias wins over a GGUF token; a GGUF token is lowercased + `_`-joined. */
function parseQuant(id: string): string | undefined {
	const bit = id.match(BIT_ALIAS_QUANT);
	if (bit) {
		return `${bit[1]}bit`;
	}
	const gguf = id.match(GGUF_QUANT);
	if (gguf) {
		// Normalize separators (`-`→`_`) and case: `q4-k-xl`→`q4_k_xl`, `Q6_K`→`q6_k`, `q8_0`→`q8_0`.
		return gguf[1].toLowerCase().replace(/-/g, "_");
	}
	return undefined;
}

/** Parameter count in billions from a standalone `NNb` token; `undefined` when absent/ambiguous (MoE tokens rejected). */
function parseParamB(id: string): number | undefined {
	const match = id.match(PARAM_SIZE);
	if (!match) {
		return undefined;
	}
	const value = Number.parseFloat(match[1]);
	return Number.isFinite(value) ? value : undefined;
}
