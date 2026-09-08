/**
 * Context-overflow wire signatures — the ONE classifier behind every seam that must recognise "the prompt did not fit
 * the model's window". PURE core.
 *
 * ── WHY ONE TABLE (P0.CTX500, live 2026-09-03 + 2026-09-05) ──
 * Two seams each kept a PRIVATE copy of this classification — the dispatch-time reactive compaction
 * (`isContextOverflowError`) and the in-turn adaptive ladder (`classifyFailureSignature`'s `context_overflow` rule) —
 * and a third (the terminal model-failover leg, `isModelSideError`) had to recognise the same wire shape to route it.
 * LM Studio's llama.cpp engine reports a generation-time overflow as an HTTP 500 whose body is llama.cpp's own
 * `"Context size has been exceeded."`, and that wording matched NEITHER private copy (both keyed on "context length" /
 * "context window"). The worker on `s42-invariant-battery` therefore got a blind same-size retry from the ladder, no
 * compaction, a "not model-side" refusal from the failover leg, and a park — for an error that describes its own
 * remedy. One table, cited per pattern, so the next engine wording is added exactly once.
 *
 * ── PROVENANCE RULE ──
 * Every pattern names where its wording was READ. Engine strings come from the engine source or a live capture, never
 * from memory: llama.cpp's server emits three distinct overflow messages (`tools/server/server-context.cpp`, plus the
 * typed envelope in `server-common.cpp` — read in the local llama.cpp-flashnext checkout at 6c84c7d5d) and LM Studio
 * forwards them verbatim inside its engine-error wrapper.
 */
export const CONTEXT_OVERFLOW_MESSAGE_PATTERNS: readonly RegExp[] = [
	// ── llama.cpp server (tools/server/server-context.cpp; LM Studio wraps these as
	//    "Engine protocol predict stream returned an error: {code:500, message:'…'}") ──
	// Generation-time overflow (`n_batch == 1 && ret == 1`) — the live P0.CTX500 wording (2026-09-03 s42 worker,
	// 2026-09-05 merge session, both parked).
	/context size has been exceeded/i,
	// Request-time overflow without context shift: "input (N tokens) is larger than the max context size (M tokens)".
	/is larger than the max context size/i,
	// Request-time overflow with context shift: "request (N tokens) exceeds the available context size (M tokens)".
	/exceeds the available context size/i,
	// The typed error envelope llama.cpp attaches to both request-time variants (`ERROR_TYPE_EXCEED_CONTEXT_SIZE`).
	/exceed_context_size_error/i,
	// LM Studio over-window probe 2026-07-20 (P21.3b): "tokens to keep from the initial prompt is greater than the
	// context length…" — the engine fails LOUD rather than truncating.
	/tokens to keep from the initial prompt/i,
	// ── OpenAI-compatible gateways ──
	// "This model's maximum context length is N tokens. However, you requested M tokens … Please reduce the length of
	// the messages or completion." + the `context_length_exceeded` error code (the `[_ ]` class covers the prose
	// "context length exceeded" and the code's underscored form in ONE pattern; "maximum context length" is already
	// carried by the generic `\bmaximum\s*context\b` below — a pattern implied by another earns no line here).
	/context[_ ]length[_ ]exceeded/i,
	/reduce the length of the messages/i,
	/reduce.*length.*messages.*completion/i,
	/contextlengthreached/i,
	// ── Anthropic-style ──
	// "prompt is too long: N tokens > M maximum".
	/prompt is too long/i,
	/tokens?\s*>\s*[\d,]+\s*(maximum|limit)/i,
	// ── Generic phrasings retained from the two prior tables (each had a live or vendor-doc origin) ──
	/maximum prompt length/i,
	/input is too long/i,
	/context overflow/i,
	/\bcontext\s*(?:length|window)\b/i,
	/\bmaximum\s*context\b/i,
	/exceeds the context/i,
	/(exceed|exceeds|exceeded).*context window/i,
	/\btoo\s*many\s*tokens?\b/i,
	/\b(?:input\s*)?tokens?\s*exceed/i,
	/maximum tokens.*exceeds.*model limit/i,
	/input length and max_tokens exceed context limit/i,
	/total number of tokens.*exceeds.*limit/i,
	/requested.*tokens.*exceeds.*limit/i,
	/requested input length.*exceeds.*maximum input length/i,
	/input token count exceeds.*maximum.*tokens? allowed/i,
	/input tokens?.*(exceed|exceeds).*(limit|maximum|context)/i,
];

/**
 * True when the error text says the prompt did not fit the model's context window. Case-insensitive; accepts the raw
 * engine body, a gateway envelope, or !Klein's own wrapped summary text — whatever survived to the seam asking.
 */
export function isContextOverflowMessage(message: string | null | undefined): boolean {
	const text = (message ?? "").trim();
	if (text.length === 0) {
		return false;
	}
	return CONTEXT_OVERFLOW_MESSAGE_PATTERNS.some((pattern) => pattern.test(text));
}
