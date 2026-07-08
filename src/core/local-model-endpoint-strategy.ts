/**
 * §5.AB endpoint-iteration STRATEGY — the pure try-order decider behind "some local model servers speak OpenAI's
 * `/v1/chat/completions`, some expose a native `/api/v1/chat` with first-class `tool_call.*` / `reasoning.*` fields,
 * and some front an Anthropic-shaped `/v1/messages` with `tool_choice:{type:"any"}` forcing. When a model won't emit
 * a usable tool call on one wire protocol, try the NEXT protocol before giving up." (David: "iterate the endpoints".)
 *
 * This module owns ONLY the ordering: given the canonical ladder and a per-model LEARNED winner (from the behavior
 * profile — recorded by a separate leaf), produce the sequence of endpoint kinds to attempt, learned-winner FIRST so
 * a known-good protocol skips the walk, then the remaining kinds in canonical order, never repeating a kind. Pure +
 * deterministic + total; the effectful clients (OpenAI / native / Anthropic) and the profile persistence are separate
 * leaves that consume this order. Keeping the decider pure means the try-order is unit-provable without any network.
 */

/** The wire protocols a local model server may speak. Canonical try-order is the array order below. */
export type LocalModelEndpointKind = "openai" | "native_v1_chat" | "anthropic_messages";

/**
 * Canonical fallback ladder. OpenAI-compatible first: it is the most widely implemented (LM Studio / Ollama /
 * llama.cpp / vLLM all serve it) and the one !Klein's existing client already speaks, so it is the cheapest, most
 * likely-to-work first hop. Native `/api/v1/chat` second: when a server exposes structured `tool_call.*` /
 * `reasoning.*` channels, they are more reliable to parse than OpenAI's text-embedded tool calls on weak models.
 * Anthropic `/v1/messages` last: its `tool_choice:{type:"any"}` can FORCE a call, the strongest hammer, tried only
 * when the gentler protocols failed.
 */
export const LOCAL_MODEL_ENDPOINT_LADDER: readonly LocalModelEndpointKind[] = [
	"openai",
	"native_v1_chat",
	"anthropic_messages",
] as const;

export interface EndpointStrategyOrderInput {
	/**
	 * The endpoint kinds this deployment actually supports/permits. Defaults to the full canonical ladder; a caller
	 * that knows a server only speaks OpenAI can pass `["openai"]` to skip doomed hops. Order here is IGNORED — the
	 * canonical ladder governs relative order; this set only GATES which kinds are eligible.
	 */
	availableKinds?: readonly LocalModelEndpointKind[];
	/**
	 * The per-model learned winner (from the §5.AB `ModelBehaviorProfile`, recorded by the persistence leaf), tried
	 * FIRST when still eligible so a known-good protocol short-circuits the ladder walk. null = nothing learned yet.
	 */
	preferredKind?: LocalModelEndpointKind | null;
}

/**
 * The ordered list of endpoint kinds to attempt: the learned winner first (when eligible), then every other eligible
 * kind in canonical ladder order. Never repeats a kind; never proposes an unavailable/unknown kind. Returns an empty
 * array only when `availableKinds` is explicitly empty (nothing to try — the caller surfaces "no endpoint").
 */
export function orderEndpointStrategies(input: EndpointStrategyOrderInput = {}): LocalModelEndpointKind[] {
	// Eligible set: default to the full ladder; intersect with the canonical order so an unknown/duplicate kind in the
	// caller's `availableKinds` can never leak in or reorder the ladder.
	const available = new Set<LocalModelEndpointKind>(input.availableKinds ?? LOCAL_MODEL_ENDPOINT_LADDER);
	const canonical = LOCAL_MODEL_ENDPOINT_LADDER.filter((kind) => available.has(kind));

	const ordered: LocalModelEndpointKind[] = [];
	const seen = new Set<LocalModelEndpointKind>();
	const push = (kind: LocalModelEndpointKind): void => {
		if (!seen.has(kind)) {
			seen.add(kind);
			ordered.push(kind);
		}
	};

	// Learned winner first — but only if it is still an eligible kind (a stale preference for a now-unavailable
	// protocol is ignored, never forced).
	if (input.preferredKind && available.has(input.preferredKind)) {
		push(input.preferredKind);
	}
	for (const kind of canonical) {
		push(kind);
	}
	return ordered;
}

/** The single next kind to try given the ones already attempted, or null when the ladder is exhausted. */
export function nextEndpointStrategy(
	attempted: readonly LocalModelEndpointKind[],
	input: EndpointStrategyOrderInput = {},
): LocalModelEndpointKind | null {
	const tried = new Set(attempted);
	for (const kind of orderEndpointStrategies(input)) {
		if (!tried.has(kind)) {
			return kind;
		}
	}
	return null;
}
