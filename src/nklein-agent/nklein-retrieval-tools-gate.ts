/**
 * §5.AC/§5.L/§5.U — the PURE, fail-closed gate deciding whether a task session gets the online `research` tool attached.
 * Extracted from `InMemoryNKleinTaskSessionService.buildRetrievalExtraTools` so the four security-relevant conditions are
 * unit-testable in isolation. ALL must hold; any failing ⇒ no tool (byte-identical to the "return []" it replaces):
 *
 *   1. NOT a synthetic session — reviewers/critics/acceptance (`::review`/`::plan-critique`/`::acceptance`) judge local
 *      work only and NEVER get egress.
 *   2. Egress is LITERALLY `true` — the fail-closed switch (default off; anything but a literal `true` denies).
 *   3. §5.L per-role capability gate allows web research (default `fully_open` ⇒ allowed).
 *   4. A non-blank search backend URL is configured — the retrieval loop searches; no backend ⇒ no online retrieval.
 */
export interface RetrievalToolsGateInput {
	/** The task session id — a synthetic session (`<taskId>::<suffix>`) never gets egress. */
	taskId: string;
	/** The global egress switch; only a literal `true` opens the gate (fail-closed). */
	egressEnabled: boolean;
	/** §5.L: whether this role's capability ruleset grants web research (default true). */
	agentWebResearchAllowed: boolean;
	/** The configured SearXNG backend base URL; null/blank ⇒ no search ⇒ no retrieval. */
	searchBackendUrl: string | null | undefined;
}

export function shouldAttachRetrievalTools(input: RetrievalToolsGateInput): boolean {
	if (input.taskId.includes("::")) {
		return false;
	}
	if (input.egressEnabled !== true) {
		return false;
	}
	if (!input.agentWebResearchAllowed) {
		return false;
	}
	if (!input.searchBackendUrl?.trim()) {
		return false;
	}
	return true;
}
