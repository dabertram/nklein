/**
 * Derive the ROUTING pool key for a swarm candidate (§5.AB LM-Link per-machine pools, user 2026-07-01).
 *
 * The swarm's machine-pool routing ({@link import("./model-swarm-route").selectSwarmRouteForTask} +
 * {@link import("./model-pool-routing").computePoolFreeSlots}) keys pools by an OPAQUE string. By default that string is
 * the ENDPOINT/baseUrl — correct when one endpoint = one machine. But under LM Studio's LM Link several linked machines
 * share ONE local endpoint (e.g. `localhost:1234`), so endpoint-keying collapses them into a single pool and the swarm
 * can't fan across the boxes. The live residency/host-cap feed uses `lms ps --json` to provide the runtime model id →
 * owning machine map, and THIS module re-keys the routing pools by that machine — so two models on different machines
 * get DISTINCT pool keys and two on the same machine share one.
 *
 * Pure + deterministic ⇒ unit-testable. When the map is absent, every helper here returns the ENDPOINT-keyed value
 * unchanged (byte-identical: same pool keys, same caps, same running counts).
 */

/**
 * The routing pool key for one candidate. With no machine map this is the endpoint, unchanged. With a map it is the
 * candidate model's owning machine, falling back to the endpoint when the model isn't in the map
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
 * Resolve the capacity of every routing pool. With no machine map this returns the endpoint caps unchanged. With a map,
 * an explicitly/effectively configured HOST cap follows the machine-keyed pool; an endpoint cap remains a second,
 * coarser ceiling. When both apply, the smaller limit wins so routing never offers work that the admission gate will
 * reject. Unmapped candidates retain endpoint-keyed behavior.
 */
export function derivePoolCaps(
	candidates: readonly { endpoint: string; modelId: string }[],
	endpointCaps: Readonly<Record<string, number>>,
	machineByModelId?: ReadonlyMap<string, string>,
	hostCaps: Readonly<Record<string, number>> = {},
): Record<string, number> {
	if (!machineByModelId) {
		return { ...endpointCaps };
	}
	const out: Record<string, number> = {};
	for (const candidate of candidates) {
		const poolKey = derivePoolKeyForCandidate(candidate.endpoint, candidate.modelId, machineByModelId);
		const caps = [endpointCaps[candidate.endpoint], hostCaps[poolKey]].filter(
			(cap): cap is number => typeof cap === "number" && Number.isFinite(cap),
		);
		if (caps.length === 0) {
			continue;
		}
		out[poolKey] = Math.min(...caps);
	}
	return out;
}
