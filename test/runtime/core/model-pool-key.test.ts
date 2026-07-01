import { describe, expect, it } from "vitest";
import { LOCAL_MACHINE_ID } from "../../../src/core/lms-ps-json";
import { derivePoolCaps, derivePoolKeyForCandidate } from "../../../src/core/model-pool-key";
import { computePoolFreeSlots } from "../../../src/core/model-pool-routing";
import { type SwarmRouteCandidate, selectSwarmRouteForTask } from "../../../src/core/model-swarm-route";

// A 2-machine LM-Link map (both instances share the same endpoint, but live on different machines):
//   coder-legion → legion-hex, coder-m5 → m5-hex; a THIRD instance (coder-local) is NOT in the map ⇒ endpoint fallback.
const MAP = new Map<string, string>([
	["coder-legion", "legion-hex"],
	["coder-m5", "m5-hex"],
	["gen-local", LOCAL_MACHINE_ID],
]);

const EP = "http://localhost:1234/v1";

describe("derivePoolKeyForCandidate", () => {
	it("keys by ENDPOINT (byte-identical) when there is no machine map", () => {
		expect(derivePoolKeyForCandidate(EP, "coder-legion", undefined)).toBe(EP);
		expect(derivePoolKeyForCandidate(EP, "anything", undefined)).toBe(EP);
	});

	it("keys by the model's owning MACHINE when the map is present", () => {
		expect(derivePoolKeyForCandidate(EP, "coder-legion", MAP)).toBe("legion-hex");
		expect(derivePoolKeyForCandidate(EP, "coder-m5", MAP)).toBe("m5-hex");
	});

	it("gives two models on DIFFERENT machines DISTINCT pool keys, two on the SAME machine ONE key", () => {
		const legion = derivePoolKeyForCandidate(EP, "coder-legion", MAP);
		const m5 = derivePoolKeyForCandidate(EP, "coder-m5", MAP);
		expect(legion).not.toBe(m5); // fanned across, though they share the endpoint

		const sameMap = new Map<string, string>([
			["a", "legion-hex"],
			["b", "legion-hex"],
		]);
		expect(derivePoolKeyForCandidate(EP, "a", sameMap)).toBe(derivePoolKeyForCandidate(EP, "b", sameMap));
	});

	it("falls back to the ENDPOINT for a model absent from the map (e.g. a cloud role, or unseen by `lms ps`)", () => {
		expect(derivePoolKeyForCandidate(EP, "not-in-map", MAP)).toBe(EP);
	});

	it("maps a LOCAL-host model to the local machine id", () => {
		expect(derivePoolKeyForCandidate(EP, "gen-local", MAP)).toBe(LOCAL_MACHINE_ID);
	});
});

describe("derivePoolCaps", () => {
	const candidates = [
		{ endpoint: EP, modelId: "coder-legion" },
		{ endpoint: EP, modelId: "coder-m5" },
		{ endpoint: EP, modelId: "not-in-map" },
	];

	it("returns the endpoint caps UNCHANGED (a copy) when there is no map", () => {
		const caps = { [EP]: 2 };
		const out = derivePoolCaps(candidates, caps, undefined);
		expect(out).toEqual(caps);
		expect(out).not.toBe(caps); // a copy, not the same reference
	});

	it("re-keys each machine pool to inherit its endpoint's cap when the map is present", () => {
		const out = derivePoolCaps(candidates, { [EP]: 2 }, MAP);
		// legion + m5 each get the endpoint's cap; the unmapped candidate keeps the endpoint key (also cap 2).
		expect(out).toEqual({ "legion-hex": 2, "m5-hex": 2, [EP]: 2 });
	});

	it("omits a pool whose endpoint has no configured cap (⇒ stays uncapped downstream)", () => {
		expect(derivePoolCaps(candidates, {}, MAP)).toEqual({});
		// A cap only on a DIFFERENT endpoint doesn't leak onto these machines.
		expect(derivePoolCaps(candidates, { "http://other/v1": 3 }, MAP)).toEqual({});
	});
});

// End-to-end proof of the §5.AB-(A)-(2) gap fix, wired EXACTLY as start-task-session.ts does: derive the pool key + caps
// with the optional machine map, feed them into computePoolFreeSlots → selectSwarmRouteForTask. Three worker models on ONE
// shared LM-Link endpoint, per-endpoint cap 1, with ONE already running on the legion machine.
describe("machine-keyed routing composition (mirrors start-task-session wiring)", () => {
	const swarmCand = (
		over: Partial<SwarmRouteCandidate> & { modelKey: string; poolId: string },
	): SwarmRouteCandidate => ({
		capability: 70,
		contextWindow: 131072,
		predictedWallTimeMs: 1000,
		isFree: true,
		facts: { kind: "code", toolUse: "TOOL_NATIVE" },
		...over,
	});
	// modelId → machineId for three instances that all serve on the SAME endpoint (the LM-Link collapse scenario).
	const machineMap = new Map<string, string>([
		["coder-legion", "legion-hex"],
		["coder-m5", "m5-hex"],
		["coder-m4", "m4-hex"],
	]);
	const guardLike = [
		{ modelKey: "coder-legion", modelId: "coder-legion", endpoint: EP },
		{ modelKey: "coder-m5", modelId: "coder-m5", endpoint: EP },
		{ modelKey: "coder-m4", modelId: "coder-m4", endpoint: EP },
	];
	// A session running on the legion machine (its endpoint is the shared EP).
	const running = [{ endpoint: EP, modelId: "coder-legion" }];
	const endpointCaps = { [EP]: 1 };

	// Build the swarm route the same way the live seam does, given the optional map.
	const route = (map: ReadonlyMap<string, string> | undefined) => {
		const poolKey = (modelId: string) => derivePoolKeyForCandidate(EP, modelId, map);
		const poolEndpoints = [...new Set(guardLike.map((c) => poolKey(c.modelId)))];
		const runningEndpoints = running.map((s) => derivePoolKeyForCandidate(s.endpoint, s.modelId, map));
		return selectSwarmRouteForTask({
			role: "worker",
			difficulty: 40,
			requiredContextTokens: 32768,
			candidates: guardLike.map((c) => swarmCand({ modelKey: c.modelKey, poolId: poolKey(c.modelId) })),
			poolFreeSlots: computePoolFreeSlots(
				poolEndpoints,
				runningEndpoints,
				derivePoolCaps(guardLike, endpointCaps, map),
			),
		});
	};

	it("flag OFF (no map) ⇒ ENDPOINT-keyed: the single shared pool is FULL (the collapse gap — no route)", () => {
		const decision = route(undefined);
		// One pool `EP`, cap 1, 1 running ⇒ 0 free ⇒ no capacity. (The gap being fixed: all machines collapse to one.)
		expect(decision.poolId).toBeNull();
		expect(decision.pool.type).toBe("no_capacity");
	});

	it("flag ON (2+ machine map) ⇒ MACHINE-keyed: the busy machine is skipped, a FREE machine is routed", () => {
		const decision = route(machineMap);
		// legion is full (its own pool cap 1 with 1 running); m5 + m4 each have their own free slot ⇒ a route exists.
		expect(decision.pool.type).toBe("assign");
		expect(decision.poolId).not.toBeNull();
		expect(decision.poolId).not.toBe("legion-hex"); // never the busy machine
		expect(["m5-hex", "m4-hex"]).toContain(decision.poolId); // fanned onto a free machine that shares the endpoint
		expect(decision.model?.selection.type).toBe("assign");
	});
});
