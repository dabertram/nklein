/**
 * Derive the ROUTING pool key for a swarm candidate (§5.AB LM-Link per-machine pools, user 2026-07-01).
 *
 * The swarm's machine-pool routing ({@link import("./model-swarm-route").selectSwarmRouteForTask} +
 * {@link import("./model-pool-routing").computePoolFreeSlots}) keys pools by an OPAQUE string. By default that string is
 * the ENDPOINT/baseUrl — correct when one endpoint = one machine. But under LM Studio's LM Link several linked machines
 * share ONE local endpoint (e.g. `localhost:1234`), so endpoint-keying collapses them into a single pool and the swarm
 * can't fan across the boxes. When the operator opts into the per-machine gate (`NKLEIN_PER_MACHINE_MAX_CONCURRENCY`),
 * `lms ps --json` gives us the runtime model id → owning machine map, and THIS module re-keys the routing pools by that
 * machine — so two models on different machines get DISTINCT pool keys and two on the same machine share one.
 *
 * Pure + deterministic ⇒ unit-testable. When the map is absent (the default — flag OFF), every helper here returns the
 * ENDPOINT-keyed value unchanged (byte-identical: same pool keys, same caps, same running counts).
 */

/**
 * The routing pool key for one candidate. With no machine map (flag OFF) this is the endpoint, unchanged. With a map
 * (flag ON) it is the candidate model's owning machine, falling back to the endpoint when the model isn't in the map
 * (e.g. a configured cloud role, or a model `lms ps` didn't report) — so an unmapped candidate keeps its endpoint pool
 * rather than being folded onto a synthetic bucket. Matched on the RUNTIME model id (the `lms ps` `identifier` = the
 * per-instance alias you invoke), which is exactly the key the map carries.
 */
export function derivePoolKeyForCandidate(
	endpoint: string,
	modelId: string,
	machineByModelId?: ReadonlyMap<string, string>,
): string {
	if (!machineByModelId) {
		return endpoint;
	}
	return machineByModelId.get(modelId) ?? endpoint;
}

/**
 * Re-key the per-ENDPOINT concurrency caps onto the routing pool keys the candidates resolve to. With no map (flag OFF)
 * this returns the endpoint caps unchanged. With a map, each candidate's machine-pool key inherits the cap of the
 * candidate's endpoint (under LM-Link every machine behind an endpoint shares that endpoint's configured cap), and an
 * endpoint-keyed pool (an unmapped candidate that fell back to its endpoint) keeps that endpoint's cap. A pool with no
 * configured endpoint cap is simply absent from the result (⇒ treated as UNCAPPED by `computePoolFreeSlots`), exactly
 * as an uncapped endpoint is today.
 */
export function derivePoolCaps(
	candidates: readonly { endpoint: string; modelId: string }[],
	endpointCaps: Readonly<Record<string, number>>,
	machineByModelId?: ReadonlyMap<string, string>,
): Record<string, number> {
	if (!machineByModelId) {
		return { ...endpointCaps };
	}
	const out: Record<string, number> = {};
	for (const candidate of candidates) {
		const cap = endpointCaps[candidate.endpoint];
		if (typeof cap !== "number" || !Number.isFinite(cap)) {
			continue; // no cap for this endpoint ⇒ its pool stays uncapped (same as endpoint keying)
		}
		out[derivePoolKeyForCandidate(candidate.endpoint, candidate.modelId, machineByModelId)] = cap;
	}
	return out;
}
