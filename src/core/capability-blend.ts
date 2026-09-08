import { blendCapabilityWithLedgerEvidence } from "./agent-ledger-projections";
import { stableFitnessModelKey } from "./fitness-routing-evidence";
import { roleEvidenceKey } from "./ledger-evidence";
import { assessRuntimeModelVerdict } from "./runtime-model-verdict";

type VerdictInput = Parameters<typeof assessRuntimeModelVerdict>[0];

/**
 * Min per-(model, role) samples before role evidence outranks the global rollup (thin role evidence is noisier). It is
 * also `blendCapabilityWithLedgerEvidence`'s own `minSamples` floor, so a row under it moves NO score: exported so a
 * caller that must tell an observation from a prior (P0.REVRANK) reads the same floor instead of re-guessing it.
 */
export const MIN_ROLE_EVIDENCE_SAMPLES = 3;

type SuccessRow = { successRate: number; samples: number };

/** Which evidence tier the blend consumed for a model — the provenance a caller needs to label a blended number. */
export type ObservedEvidenceSource = "role_ledger" | "fitness_sweep" | "global_ledger";

export interface ObservedEvidence extends SuccessRow {
	source: ObservedEvidenceSource;
}

export interface CapabilityBlender {
	/** The runtime-verdict penalty for a model (TOOL_UNSUITABLE x0.1, TOOL_WEAK x0.5, else x1); memoized per model. */
	verdictMultiplier: (modelId: string) => number;
	/**
	 * Blend a candidate's registry `baseCapability` with its LEDGER-observed success rate, preferring per-(model, role)
	 * evidence when it has enough samples, else the global per-model rollup; then scale by the runtime-verdict penalty
	 * when a `modelId` is given. Returns the base score unchanged when there is no ledger evidence.
	 */
	blendedCapabilityForKey: (
		modelKey: string,
		baseCapability: number,
		role?: string | null,
		modelId?: string,
	) => number;
	/**
	 * The observed evidence `blendedCapabilityForKey` would consume for this key/role — the SAME tier selection (role
	 * ledger ≥ min samples, else fitness sweep ≥ min samples, else the global rollup), or null when no row exists at
	 * all. P0.REVRANK: a caller that must not mistake a prior for a measurement asks this first; exposing the selection
	 * rather than re-deriving it keeps "did evidence apply" and "what evidence applied" one fact. The global rollup is
	 * reported whenever a row exists — the blend itself still ignores rows under its own `minSamples` (3), so read
	 * `samples` before trusting the number as observed.
	 */
	observedEvidenceForKey: (modelKey: string, role?: string | null) => ObservedEvidence | null;
}

/**
 * Routing capability blender (todo.md 5.AF/5.AB), extracted from the `handleStartTaskSession` hot path (5.U). Given the
 * ledger evidence + the self-observation events, it returns the two blend functions the router uses, encapsulating the
 * per-model verdict memoization + the role-vs-global evidence preference. Pure given its inputs (the memo cache is
 * internal + per-blender), so the blend math, the role-outranks-global rule, and the verdict penalties are unit-testable
 * without the ledger store. Keys role evidence via {@link roleEvidenceKey} -- the SAME helper the builder uses, so the
 * write and read keys can never drift.
 */
export function createCapabilityBlender(input: {
	successByKey: ReadonlyMap<string, SuccessRow>;
	roleSuccessByKey: ReadonlyMap<string, SuccessRow>;
	/**
	 * Optional §5.AB SWEEP evidence (fitness table projected by `buildFitnessRoutingEvidence`), keyed by
	 * roleEvidenceKey(stableFitnessModelKey(model), role). Slots BETWEEN role-ledger evidence and the global rollup:
	 * real tasks beat benchmarks, benchmarks beat nothing — so a freshly-swept model routes on its measured role
	 * fitness instead of the neutral registry prior. Omitted ⇒ byte-identical to the ledger-only blend.
	 */
	fitnessRoleSuccessByKey?: ReadonlyMap<string, SuccessRow>;
	verdictRuns: NonNullable<VerdictInput["runs"]>;
	selfObservationEvents: NonNullable<VerdictInput["events"]>;
}): CapabilityBlender {
	const verdictMemo = new Map<string, number>();
	const verdictMultiplier = (modelId: string): number => {
		const cached = verdictMemo.get(modelId);
		if (cached !== undefined) {
			return cached;
		}
		const verdict =
			input.selfObservationEvents.length > 0 || input.verdictRuns.length > 0
				? assessRuntimeModelVerdict({ modelId, events: input.selfObservationEvents, runs: input.verdictRuns })
						.verdict
				: "UNKNOWN";
		const multiplier = verdict === "TOOL_UNSUITABLE" ? 0.1 : verdict === "TOOL_WEAK" ? 0.5 : 1;
		verdictMemo.set(modelId, multiplier);
		return multiplier;
	};
	const observedEvidenceForKey = (modelKey: string, role?: string | null): ObservedEvidence | null => {
		const roleObserved = role ? input.roleSuccessByKey.get(roleEvidenceKey(modelKey, role)) : undefined;
		if (roleObserved && roleObserved.samples >= MIN_ROLE_EVIDENCE_SAMPLES) {
			return { ...roleObserved, source: "role_ledger" };
		}
		// Fitness (sweep) role evidence is keyed by the NORMALIZED model id so the eval harness's bare keys and the
		// runtime's canonical keys resolve to the same row regardless of which shape the router passes.
		const fitnessObserved =
			role && input.fitnessRoleSuccessByKey
				? input.fitnessRoleSuccessByKey.get(roleEvidenceKey(stableFitnessModelKey(modelKey), role))
				: undefined;
		if (fitnessObserved && fitnessObserved.samples >= MIN_ROLE_EVIDENCE_SAMPLES) {
			return { ...fitnessObserved, source: "fitness_sweep" };
		}
		const global = input.successByKey.get(modelKey);
		return global ? { ...global, source: "global_ledger" } : null;
	};
	const blendedCapabilityForKey = (
		modelKey: string,
		baseCapability: number,
		role?: string | null,
		modelId?: string,
	): number => {
		const observed = observedEvidenceForKey(modelKey, role);
		const blended = blendCapabilityWithLedgerEvidence(
			baseCapability,
			observed?.successRate ?? null,
			observed?.samples ?? 0,
		);
		return modelId ? blended * verdictMultiplier(modelId) : blended;
	};
	return { verdictMultiplier, blendedCapabilityForKey, observedEvidenceForKey };
}
