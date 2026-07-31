/**
 * Canonical model identity normalization — the single source of truth shared by the model registry
 * (key construction), the endpoint scheduler (shared-endpoint serialization), and the model-performance
 * telemetry aggregates. Keeping one implementation is what lets those surfaces *agree*: the registry must
 * not register `localhost` and `127.0.0.1` as two models while telemetry counts them as one (todo §5.Q).
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * The sentinel a blank coordinate collapses to.
 *
 * It exists so a key is always well-formed, but **a key containing it identifies no model** — and that
 * distinction is load-bearing, because the sentinel is not a value, it is the absence of one wearing a value's
 * shape. See {@link isAttributableModelKey}.
 */
export const UNRESOLVED_IDENTITY_SEGMENT = "unknown";

/** Provider ids are case-insensitive; blank collapses to the `"unknown"` sentinel. */
export function normalizeProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	return normalized.length > 0 ? normalized : UNRESOLVED_IDENTITY_SEGMENT;
}

/** Model ids are case-sensitive (vendor slugs vary); blank collapses to the `"unknown"` sentinel. */
export function normalizeModelId(modelId: string): string {
	const normalized = modelId.trim();
	return normalized.length > 0 ? normalized : UNRESOLVED_IDENTITY_SEGMENT;
}

/**
 * Does this `provider:model:endpoint` key actually name a model?
 *
 * ── WHY THIS PREDICATE EXISTS (found 2026-07-31 on the live ledger) ──
 * `normalizeModelId("")` returns `"unknown"`, so a key built from a missing model id is well-formed and
 * indistinguishable, by shape, from a real one. **70 of 238 attempt events on the live ledger — 29% — were
 * recorded as `lmstudio:unknown:default`**, and they behaved like a real model everywhere downstream: they
 * formed their own row in per-model fitness and edit-reliability rollups, carrying 1074 tool calls that belong
 * to other models. A phantom model with a plausible-looking success rate is worse than a gap, because a gap is
 * visibly a gap.
 *
 * ── WHY SEGMENT 1 IS SAFE TO READ THIS WAY ──
 * The key is `provider:model:endpoint` and the ENDPOINT contains colons (`http://localhost:1234/v1`), so the key
 * cannot be split into exactly three parts. It does not need to be: provider ids are simple lowercase tokens with
 * no colons, so segment 1 is always the model. The check can therefore only fire when the model segment is
 * exactly the sentinel — and a real model literally named `unknown` would be refused, which is the safe
 * direction.
 */
export function isAttributableModelKey(registryKey: string): boolean {
	return registryKey.split(":")[1] !== UNRESOLVED_IDENTITY_SEGMENT;
}

/**
 * Canonicalize an endpoint URL so the same local server addressed differently maps to one key. All
 * loopback spellings (`localhost`/`127.0.0.1`/`0.0.0.0`/`::1`) address the same local server, so the host
 * is canonicalized to `localhost` and any trailing slash dropped. Non-URL strings are returned trimmed;
 * blank/absent endpoints return `null`.
 */
export function normalizeEndpoint(endpoint: string | null | undefined): string | null {
	if (typeof endpoint !== "string") {
		return null;
	}
	const trimmed = endpoint.trim();
	if (trimmed.length === 0) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return trimmed;
	}
	if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
		parsed.hostname = "localhost";
	}
	const path = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}
