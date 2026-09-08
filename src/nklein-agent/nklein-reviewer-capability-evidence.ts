import type { AgentLedgerEvent } from "../core/agent-attempt-ledger";
import { type CapabilityBlender, createCapabilityBlender, MIN_ROLE_EVIDENCE_SAMPLES } from "../core/capability-blend";
import { deriveCapabilityPrior } from "../core/capability-prior-from-catalog";
import { isEnabledByDefaultEnv } from "../core/env-flag";
import { buildFitnessRoutingEvidence } from "../core/fitness-routing-evidence";
import type { FitnessRow } from "../core/fitness-table-schema";
import { buildLedgerEvidence } from "../core/ledger-evidence";
import { lookupModelCapability } from "../core/model-capability-catalog";
import type { ReviewerCapabilityEvidence } from "../core/reviewer-capability-ranking";
import type { SwarmRole } from "../core/role-model-class";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { resolveStableRoutingModelId } from "../state/runtime-id-model-key-map-store";
import { readFitnessTable } from "../telemetry/fitness-table-store";
import { readSelfObservationEvents, type SelfObservationEventRecord } from "../telemetry/self-observation-sink";
import {
	getDefaultNKleinModelRegistry,
	type NKleinModelRegistryCapabilityStats,
	type NKleinModelRegistryEntry,
	type NKleinModelRegistrySnapshot,
} from "./nklein-model-registry";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry-key";
import { DEFAULT_CAPABILITY_PRIOR } from "./nklein-model-registry-scoring";

/**
 * P0.REVRANK — the capability EVIDENCE behind the reviewer / escalation ranking (`reviewer-capability-ranking`).
 *
 * The worker router blends each candidate's registry capability with ledger success rates, sweep fitness and the
 * runtime verdict (`createCapabilityBlender`, start-task-session) — the reviewer picker never saw any of it and ranked
 * on catalog class fit alone. This module reads the SAME four sources once per pick and answers, per loaded model and
 * role, "what do we actually know about its capability?" — or null when the honest answer is nothing.
 *
 * ── IDENTITY, OR THE LOOKUP SILENTLY MISSES (§4A ledger-key drift) ──
 *  · The REGISTRY is written under the launch/runtime id (`recordRequest` ← `resolveTaskModelIdentity`), keyed
 *    `provider:runtimeId:endpoint`.
 *  · The LEDGER's terminal attempts are written under the STABLE id (`buildTerminalAttemptEvent` ←
 *    `resolveStableRoutingModelId`, default-on `NKLEIN_STABLE_ROUTING_KEY`), keyed `provider:stableId:endpoint` — and
 *    the shared runtime-id→key map may be cold in this process, so the real publisher key (what the map resolves to)
 *    and the bare runtime id are probed too; the first key with a row wins.
 *  · FITNESS rows are keyed by bare ids; the blender normalizes both sides (`stableFitnessModelKey`).
 *
 * ── WHAT COUNTS AS EVIDENCE (the green-signal rule) ──
 * `observed` = a ledger/fitness row the blend would consume (≥ its 3-sample floor) or registry eval samples.
 * `prior` = only the curated §5.AL catalog knows the family (`deriveCapabilityPrior`, the SAME number the registry seeds
 * `staticPrior` from — so a model used once and a model never used agree). Uncatalogued AND unobserved ⇒ null: the
 * registry's flat 35 for such a model is an anchor for blending real observations, never a claim on its own.
 *
 * Kill switch: `NKLEIN_REVIEWER_CAPABILITY_RANKING=0|false|off` returns a source that knows nothing, restoring the
 * class-fit-only order byte-for-byte (and performs no I/O).
 */

export interface ReviewerCapabilityEvidenceSource {
	/** False under the kill switch — every `resolve` returns null and class fit orders the candidates. */
	readonly enabled: boolean;
	resolve(model: { runtimeId: string; modelKey: string }, role: SwarmRole): ReviewerCapabilityEvidence | null;
}

/** Injectable readers (tests, isolated captures); each defaults to the live store. */
export interface ReviewerCapabilityEvidenceIo {
	readRegistrySnapshot: () => Promise<NKleinModelRegistrySnapshot>;
	readLedger: () => Promise<readonly AgentLedgerEvent[]>;
	readFitnessRows: () => Promise<readonly FitnessRow[]>;
	readSelfObservationEvents: () => Promise<SelfObservationEventRecord[]>;
	resolveStableModelId: (runtimeId: string) => string;
	/** The curated prior for a REAL key, or null when the family is uncatalogued (never a flat default). */
	lookupCatalogPrior: (realKey: string) => number | null;
}

export interface LoadReviewerCapabilityEvidenceInput {
	providerId: string;
	/** The endpoint the reviewer/escalation session launches against (the registry + ledger key endpoint). */
	endpoint: string | null;
	/** Isolated ledger root (F1.26b) when the caller runs under one; undefined ⇒ the default/async-scoped root. */
	ledgerRootDir?: string;
	io?: Partial<ReviewerCapabilityEvidenceIo>;
	env?: NodeJS.ProcessEnv;
}

/** The knows-nothing source (kill switch / load failure): class fit orders, nothing is invented. */
export const DISABLED_REVIEWER_CAPABILITY_EVIDENCE: ReviewerCapabilityEvidenceSource = {
	enabled: false,
	resolve: () => null,
};

const REGISTRY_SNAPSHOT_TIMEOUT_MS = 5_000;

function emptyRegistrySnapshot(): NKleinModelRegistrySnapshot {
	return { schemaVersion: 1, updatedAt: 0, models: {} };
}

/** The registry snapshot, bounded: a pending-forever snapshot (a wedged discovery refresh) must not hang a review. */
async function readRegistrySnapshotBounded(): Promise<NKleinModelRegistrySnapshot> {
	return await Promise.race([
		Promise.resolve(getDefaultNKleinModelRegistry().getSnapshot()).catch(() => emptyRegistrySnapshot()),
		new Promise<NKleinModelRegistrySnapshot>((resolve) => {
			const timer = setTimeout(() => resolve(emptyRegistrySnapshot()), REGISTRY_SNAPSHOT_TIMEOUT_MS);
			timer.unref?.();
		}),
	]);
}

function catalogPriorForRealKey(realKey: string): number | null {
	return lookupModelCapability(realKey) ? deriveCapabilityPrior(realKey) : null;
}

/** Eval/external/observed signal actually recorded on the registry entry (a bare seeded prior has none). */
function hasObservedCapability(capability: NKleinModelRegistryCapabilityStats): boolean {
	return (
		capability.samples > 0 ||
		capability.evalScore !== null ||
		capability.externalScore !== null ||
		capability.observedPassRate !== null
	);
}

function unique<T>(values: readonly T[]): T[] {
	return [...new Set(values)];
}

function formatPercent(rate: number): string {
	return `${Math.round(rate * 100)}% ok`;
}

/** Pure given its loaded inputs: the per-model resolver the ranking consumes. Exported for direct unit tests. */
export function createReviewerCapabilityEvidenceSource(input: {
	providerId: string;
	endpoint: string | null;
	registry: NKleinModelRegistrySnapshot;
	blender: CapabilityBlender;
	resolveStableModelId: (runtimeId: string) => string;
	lookupCatalogPrior: (realKey: string) => number | null;
}): ReviewerCapabilityEvidenceSource {
	const endpoints = unique<string | null>([input.endpoint?.trim() || null, null]);
	const keysFor = (modelId: string): string[] =>
		unique(
			endpoints.map((endpoint) => buildNKleinModelRegistryKey({ providerId: input.providerId, modelId, endpoint })),
		);
	const findRegistryEntry = (runtimeId: string): NKleinModelRegistryEntry | null => {
		for (const key of keysFor(runtimeId)) {
			const entry = input.registry.models[key];
			if (entry) {
				return entry;
			}
		}
		return null;
	};
	return {
		enabled: true,
		resolve(model, role) {
			const entry = findRegistryEntry(model.runtimeId);
			const registryObserved = entry !== null && hasObservedCapability(entry.capability);
			const catalogPrior = input.lookupCatalogPrior(model.modelKey);
			// Ledger/fitness rows: the stable id the write seam used, the real key it resolves to when the shared map is
			// warm, and the bare runtime id (flag off / unmapped) — the first shape with a row is the one that was written.
			const ledgerKeys = unique([
				...keysFor(input.resolveStableModelId(model.runtimeId)),
				...keysFor(model.modelKey),
				...keysFor(model.runtimeId),
			]);
			const probed = ledgerKeys
				.map((key) => ({ key, observed: input.blender.observedEvidenceForKey(key, role) }))
				.find((candidate) => candidate.observed !== null);
			const ledgerKey = probed?.key ?? (ledgerKeys[0] as string);
			// The blend itself ignores rows under its own floor (it returns the base unchanged), so a thinner row moved no
			// number and is not an observation either — reading the SAME constant keeps the two from drifting apart.
			const observed =
				probed?.observed && probed.observed.samples >= MIN_ROLE_EVIDENCE_SAMPLES ? probed.observed : null;
			if (!registryObserved && observed === null && catalogPrior === null) {
				return null;
			}
			// Base: the registry's eval-informed effective score when it has any; else the curated catalog prior (the
			// number the registry seeds from, by REAL key — a served alias may have seeded the flat default); else, only
			// under real observations, the flat anchor the registry itself blends uncatalogued models from.
			const base = registryObserved
				? (entry as NKleinModelRegistryEntry).capability.effectiveScore
				: (catalogPrior ?? DEFAULT_CAPABILITY_PRIOR);
			const score = input.blender.blendedCapabilityForKey(ledgerKey, base, role, model.runtimeId);
			const verdictMultiplier = input.blender.verdictMultiplier(model.runtimeId);
			const registrySamples = registryObserved ? (entry as NKleinModelRegistryEntry).capability.samples : 0;
			const detail = [
				observed
					? `${role} ${observed.source.replace(/_/g, " ")} ${observed.samples} samples (${formatPercent(observed.successRate)})`
					: null,
				registryObserved
					? `registry ${registrySamples} eval samples (effective ${(entry as NKleinModelRegistryEntry).capability.effectiveScore})`
					: null,
				!registryObserved
					? catalogPrior !== null
						? `catalog prior ${catalogPrior}`
						: `flat anchor ${base}`
					: null,
				verdictMultiplier !== 1 ? `runtime verdict ×${verdictMultiplier}` : null,
			]
				.filter((part): part is string => part !== null)
				.join(", ");
			return {
				score,
				basis: registryObserved || observed !== null ? "observed" : "prior",
				samples: (observed?.samples ?? 0) + registrySamples,
				detail,
			};
		},
	};
}

/**
 * Read the four evidence stores once (best-effort — any reader failure degrades to "no rows", never a throw) and build
 * the resolver. Under the kill switch this performs NO I/O and returns the knows-nothing source.
 */
export async function loadReviewerCapabilityEvidence(
	input: LoadReviewerCapabilityEvidenceInput,
): Promise<ReviewerCapabilityEvidenceSource> {
	const env = input.env ?? process.env;
	if (!isEnabledByDefaultEnv(env.NKLEIN_REVIEWER_CAPABILITY_RANKING)) {
		return DISABLED_REVIEWER_CAPABILITY_EVIDENCE;
	}
	const io: ReviewerCapabilityEvidenceIo = {
		readRegistrySnapshot: readRegistrySnapshotBounded,
		readLedger: () =>
			readAllAgentLedger(input.ledgerRootDir !== undefined ? { rootDir: input.ledgerRootDir } : undefined),
		// Mirrors the start path's sweep-evidence kill switch, so both routers read the same fitness truth.
		readFitnessRows: async () =>
			/^(0|false|off)$/i.test(env.NKLEIN_FITNESS_ROUTING ?? "")
				? []
				: Object.values((await readFitnessTable()).rows),
		readSelfObservationEvents: () => readSelfObservationEvents({ limit: 500 }),
		resolveStableModelId: (runtimeId) =>
			isEnabledByDefaultEnv(env.NKLEIN_STABLE_ROUTING_KEY) ? resolveStableRoutingModelId(runtimeId) : runtimeId,
		lookupCatalogPrior: catalogPriorForRealKey,
		...input.io,
	};
	const [registry, ledgerEvidence, fitnessRows, selfObservationEvents] = await Promise.all([
		io.readRegistrySnapshot().catch(() => emptyRegistrySnapshot()),
		buildLedgerEvidence(io.readLedger),
		io.readFitnessRows().catch(() => [] as FitnessRow[]),
		io.readSelfObservationEvents().catch(() => [] as SelfObservationEventRecord[]),
	]);
	const blender = createCapabilityBlender({
		successByKey: ledgerEvidence.successByKey,
		roleSuccessByKey: ledgerEvidence.roleSuccessByKey,
		fitnessRoleSuccessByKey: buildFitnessRoutingEvidence(fitnessRows).fitnessRoleSuccessByKey,
		verdictRuns: ledgerEvidence.verdictRuns,
		selfObservationEvents,
	});
	return createReviewerCapabilityEvidenceSource({
		providerId: input.providerId,
		endpoint: input.endpoint,
		registry,
		blender,
		resolveStableModelId: io.resolveStableModelId,
		lookupCatalogPrior: io.lookupCatalogPrior,
	});
}
