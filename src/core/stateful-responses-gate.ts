/**
 * F4.45 — stateful LM Studio responses, gated on VERIFICATION (pure core + injectable probe).
 *
 * LM Studio's `/v1/responses` API can carry conversation state server-side (`previous_response_id`), cutting
 * per-turn resend cost. Adoption is only safe "where verified": the endpoint must actually implement the API
 * (older builds 404 it; some proxies strip it), and the session layer must keep OWNING the transcript so replay
 * and compaction stay correct with a STATELESS fallback at any moment. This module owns the probe decision and
 * the opt-in gate; the transcript-ownership adoption in the session path is the (large) remaining wire.
 */

export interface StatefulResponsesProbeResult {
	/** HTTP status the endpoint returned for a minimal `/v1/responses` request; null = network failure. */
	status: number | null;
	/** True when the response body parsed and carried a response `id` (the handle previous_response_id needs). */
	returnedResponseId: boolean;
}

export interface StatefulResponsesDecision {
	adopt: boolean;
	reason: string;
}

/**
 * Decide adoption from a live probe + the opt-in env. Fail-closed on every uncertainty: not opted in, probe
 * failed, endpoint 404s/500s, or no response id ⇒ stateless (the existing, proven path).
 */
export function decideStatefulResponsesAdoption(input: {
	envOptIn: boolean;
	probe: StatefulResponsesProbeResult | null;
}): StatefulResponsesDecision {
	if (!input.envOptIn) {
		return { adopt: false, reason: "NKLEIN_STATEFUL_RESPONSES not set — stateless path (default)" };
	}
	if (!input.probe || input.probe.status === null) {
		return { adopt: false, reason: "probe failed (network) — stateless fallback" };
	}
	if (input.probe.status !== 200) {
		return {
			adopt: false,
			reason: `endpoint answered ${input.probe.status} for /v1/responses — not supported; stateless fallback`,
		};
	}
	if (!input.probe.returnedResponseId) {
		return {
			adopt: false,
			reason: "endpoint returned 200 but no response id — cannot chain previous_response_id; stateless fallback",
		};
	}
	return { adopt: true, reason: "verified: /v1/responses live and returns a chainable response id" };
}

/**
 * Probe the endpoint once with a minimal 1-token request. Injectable fetch; never throws (network errors map to
 * status null). The caller caches the result per endpoint — this is a capability check, not a per-turn call.
 */
export async function probeStatefulResponses(
	baseUrl: string,
	modelId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<StatefulResponsesProbeResult> {
	try {
		const response = await fetchImpl(`${baseUrl.replace(/\/+$/u, "")}/responses`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: modelId, input: "ping", max_output_tokens: 1, store: true }),
		});
		if (!response.ok) {
			return { status: response.status, returnedResponseId: false };
		}
		const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
		return { status: response.status, returnedResponseId: typeof body?.id === "string" && body.id.length > 0 };
	} catch {
		return { status: null, returnedResponseId: false };
	}
}
