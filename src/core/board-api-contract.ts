import { z } from "zod";
import {
	agentDeliveryTierSchema,
	type RuntimeTaskNKleinSettings,
	runtimeAgentIdWithLegacyMigrationSchema,
	runtimeBoardColumnIdSchema,
	runtimeTaskAutoReviewModeSchema,
	runtimeTaskNKleinSettingsSchema,
} from "./runtime-config-api-contract.js";
import { resolveTaskTitle } from "./task-title.js";

// Board contract domain: task images, generated-from-plan provenance, card review (verdict/round/summary),
// focus chains, and the board card / column / dependency / data shapes. Split out of api-contract.ts (§5.X #2),
// re-exported through the `@runtime-contract` barrel. Imports the config primitives it builds on from
// runtime-config-api-contract.ts (never the barrel — no zod-const load-order cycle).

export const runtimeTaskImageSchema = z.object({
	id: z.string(),
	data: z.string(),
	mimeType: z.string(),
	name: z.string().optional(),
});
export type RuntimeTaskImage = z.infer<typeof runtimeTaskImageSchema>;

/**
 * Where delivery-time test evidence is expected to come from. Ordinary cards keep the default agent-visible policy;
 * leakage-safe benchmark cards use an external held-out oracle and therefore cannot be required to add those tests.
 */
export const runtimeTaskTestEvidencePolicySchema = z.enum(["agent_visible", "externally_held_out"]);

/** F1.34b-ext: a card's upfront testability declaration (mirrors `TaskTestability` in test-driven-delivery.ts). */
export const runtimeTaskTestabilitySchema = z.enum(["testable", "not_testable"]);
export type RuntimeTaskTestability = z.infer<typeof runtimeTaskTestabilitySchema>;
export type RuntimeTaskTestEvidencePolicy = z.infer<typeof runtimeTaskTestEvidencePolicySchema>;

export const runtimeFleetSizingCandidateSchema = z.object({
	modelKey: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	capability: z.number().min(0).max(100),
	contextWindow: z.number().int().nonnegative(),
});
export type RuntimeFleetSizingCandidate = z.infer<typeof runtimeFleetSizingCandidateSchema>;

export const runtimeFleetSizingSchema = z.object({
	fingerprint: z.string().min(1),
	candidates: z.array(runtimeFleetSizingCandidateSchema).min(1),
	taskDifficulty: z.number().min(0).max(100),
	promptTokens: z.number().int().nonnegative(),
	fitBudgetTokens: z.number().int().nonnegative(),
	autoReshardOnFleetChange: z.boolean().default(true),
});
export type RuntimeFleetSizing = z.infer<typeof runtimeFleetSizingSchema>;

export const runtimeGeneratedFromPlanSchema = z.object({
	artifactKind: z.enum(["decomposition", "buildout", "spec"]).default("decomposition"),
	planSlug: z.string().min(1),
	planTaskId: z.string().min(1),
	sourceTaskId: z.string().min(1).nullable().optional(),
	/** The loaded fleet and routing requirement this card was sized against. Absent on legacy/non-fleet plans. */
	fleetSizing: runtimeFleetSizingSchema.optional(),
});
export type RuntimeGeneratedFromPlan = z.infer<typeof runtimeGeneratedFromPlanSchema>;

export const runtimeFleetReshardRequestSchema = z.object({
	planSlug: z.string().min(1),
	targetPlanTaskIds: z.array(z.string().min(1)).min(1),
	fromFleetFingerprints: z.array(z.string().min(1)).min(1),
	toFleetFingerprint: z.string().min(1),
	requestedAt: z.number(),
});
export type RuntimeFleetReshardRequest = z.infer<typeof runtimeFleetReshardRequestSchema>;

const runtimeLegacyTaskNKleinReasoningEffortSchema = z.enum(["default", "low", "medium", "high", "xhigh"]);

function normalizeRuntimeTaskNKleinSettings(input: {
	nkleinSettings?: RuntimeTaskNKleinSettings;
	nkleinProviderId?: string;
	nkleinModelId?: string;
	nkleinReasoningEffort?: z.infer<typeof runtimeLegacyTaskNKleinReasoningEffortSchema>;
}): RuntimeTaskNKleinSettings | undefined {
	if (input.nkleinSettings !== undefined) {
		return input.nkleinSettings;
	}
	const providerId = input.nkleinProviderId?.trim();
	const modelId = input.nkleinModelId?.trim();
	if (!providerId && !modelId && input.nkleinReasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(input.nkleinReasoningEffort && input.nkleinReasoningEffort !== "default"
			? { reasoningEffort: input.nkleinReasoningEffort }
			: {}),
	};
}

export const runtimeReviewVerdictSchema = z.enum(["approve", "request_changes"]);
export type RuntimeReviewVerdict = z.infer<typeof runtimeReviewVerdictSchema>;

/** One second-opinion review round, persisted on the card for stall/identical-loop detection + display. */
export const runtimeReviewRoundRecordSchema = z.object({
	round: z.number().int().positive(),
	verdict: runtimeReviewVerdictSchema,
	feedbackFingerprint: z.string().nullable(),
	workFingerprint: z.string().nullable(),
	// Review→next-attempt feedback maximization (David 2026-08-12): the round's actual TEXT rides the record
	// (clamped at write) so later attempts and a re-decompose can present ALL distinct concerns, not only
	// `lastFeedback`. Additive optional — records from older boards simply have no text.
	summary: z.string().optional(),
	feedback: z.string().optional(),
});
export type RuntimeReviewRoundRecord = z.infer<typeof runtimeReviewRoundRecordSchema>;

/** Immutable provenance for the exact primary/speculative artifact selected at the delivery seam. */
export const runtimeTaskResultArtifactReceiptSchema = z.object({
	resultBranchTaskId: z.string().min(1),
	resultCommit: z.string().min(1),
	recordedAt: z.number(),
});
export type RuntimeTaskResultArtifactReceipt = z.infer<typeof runtimeTaskResultArtifactReceiptSchema>;

/** Persisted second-opinion review state for a worker card (todo §5.K). Whole-object LWW on the board CRDT. */
export const runtimeCardReviewSchema = z.object({
	/** Lifecycle of the review loop for this card. */
	status: z.enum(["in_review", "changes_requested", "approved", "parked"]),
	/** Highest review round reached (0 before the first review starts). */
	round: z.number().int().nonnegative(),
	/** All review rounds so far, oldest first. */
	history: z.array(runtimeReviewRoundRecordSchema).default([]),
	lastVerdict: runtimeReviewVerdictSchema.nullable().default(null),
	lastSummary: z.string().nullable().default(null),
	lastFeedback: z.string().nullable().default(null),
	lastInsight: z.string().nullable().default(null),
	/** Reviewer sign-off recorded on approval (summary + optional insight). */
	signOff: z.string().nullable().default(null),
	/** Reason the loop parked, when status is `parked`. */
	parkedReason: z.string().nullable().default(null),
	/** True once this card's ONE diverse-worker escalation has fired (§5.AW W4.2 — server-side truth; optional for older boards). */
	escalated: z.boolean().optional(),
	/**
	 * §5.AW best-of-N: the reviewer's A/B arbitration pick, persisted so a restart BETWEEN the review verdict
	 * and delivery still delivers the winning candidate (without it, delivery falls back to primary). Absent on
	 * non-arbitration reviews and older boards.
	 */
	preferredCandidate: z.enum(["primary", "speculative"]).optional(),
	/** Exact accepted artifact, persisted before candidate refs are pruned; superseded when a later review object is written. */
	resultArtifact: runtimeTaskResultArtifactReceiptSchema.optional(),
	updatedAt: z.number(),
});
export type RuntimeCardReview = z.infer<typeof runtimeCardReviewSchema>;

/**
 * F12.53: the persisted per-card VERIFICATION snapshot — the artifact's own pass/fail, distinct from the reviewer's
 * opinion (`review`), so trust attaches to the verified artifact rather than an agent self-report. Written wherever
 * the acceptance check actually runs (the on-demand verify procedure + the auto-delivery gate); additive optional
 * (CRDT whole-object LWW) so older boards load as-is.
 */
export const runtimeCardVerificationSchema = z.object({
	/** Whether the card defines an acceptance command at all. */
	acceptancePresent: z.boolean(),
	/** The last acceptance run's verdict; null when the check could not run. */
	acceptancePassed: z.boolean().nullable(),
	/** Sanitized one-liner for the badge tooltip (command + failure hint — never raw output). */
	detail: z.string().nullable(),
	checkedAt: z.number(),
});
export type RuntimeCardVerification = z.infer<typeof runtimeCardVerificationSchema>;

/** A single step of an agent's focus chain (todo §5.N). */
export const runtimeFocusChainStepSchema = z.object({
	text: z.string(),
	status: z.enum(["pending", "in_progress", "done", "skipped"]),
	// Per-step timing (todo §5.N) — stamped by !Klein (not the agent) when a step first becomes active / finishes,
	// so the UI/telemetry can show how long each step took. Optional/absent for pre-timing chains.
	startedAt: z.number().optional(),
	completedAt: z.number().optional(),
	// Files/cards a step touched while active (todo §5.N) — stamped by !Klein, accumulated + deduped. Optional/absent
	// for chains from before touch-linking (and for steps that touched nothing).
	touchedFiles: z.array(z.string()).optional(),
	touchedCardIds: z.array(z.string()).optional(),
});
export type RuntimeFocusChainStep = z.infer<typeof runtimeFocusChainStepSchema>;

/** An agent's self-authored task checklist (focus chain), persisted on the card for display + re-anchoring. */
export const runtimeFocusChainSchema = z.object({
	steps: z.array(runtimeFocusChainStepSchema).default([]),
	updatedAt: z.number(),
});
export type RuntimeFocusChain = z.infer<typeof runtimeFocusChainSchema>;

export const runtimeBoardCardSchema = z
	.object({
		id: z.string(),
		title: z.string().optional(),
		prompt: z.string(),
		startInPlanMode: z.boolean(),
		review: runtimeCardReviewSchema.optional(),
		verification: runtimeCardVerificationSchema.optional(),
		// Additive + optional for persisted-board compatibility. Undefined means the strict ordinary-card default.
		testEvidencePolicy: runtimeTaskTestEvidencePolicySchema.optional(),
		// F1.34b-ext (David 2026-07-23): upfront testability declaration. Absent ⇒ `testable` (the strict default —
		// the test-driven gate applies). `not_testable` is declared at decompose time or by the operator, with the
		// reason kept for the audit trail; the worker being gated can never set it. Additive optional (CRDT
		// whole-object LWW) so older boards load as-is.
		testability: runtimeTaskTestabilitySchema.optional(),
		testabilityReason: z.string().optional(),
		focusChain: runtimeFocusChainSchema.optional(),
		// Per-card delivery-autonomy override (todo §5.L): when set, wins over the project + global/role delivery
		// tier at the auto-delivery gate. Additive optional field (CRDT whole-object LWW), so older boards load as-is.
		deliveryTierOverride: agentDeliveryTierSchema.optional(),
		autoReviewEnabled: z.boolean().optional(),
		/** F11.3g: an EXTERNALLY SUPERVISED card (benchmark harness, external driver) — !Klein's autonomous
		 *  rescue/redrive machinery must leave its terminal states to the supervisor. Additive; absent = false. */
		externallySupervised: z.boolean().optional(),
		autoReviewMode: runtimeTaskAutoReviewModeSchema.optional(),
		autoReviewStatus: z.enum(["running", "failed"]).optional(),
		autoReviewMessage: z.string().optional(),
		images: z.array(runtimeTaskImageSchema).optional(),
		agentId: runtimeAgentIdWithLegacyMigrationSchema.optional(),
		nkleinSettings: runtimeTaskNKleinSettingsSchema.optional(),
		filesLikelyTouched: z.array(z.string()).optional(),
		// F1.9 work-package bounds (additive optional, CRDT whole-object LWW): copied from the plan task at
		// decompose-apply so dispatch/review can enforce them without re-reading plan artifacts.
		writeScope: z.array(z.string()).optional(),
		forbiddenPaths: z.array(z.string()).optional(),
		generatedFromPlan: runtimeGeneratedFromPlanSchema.optional(),
		/**
		 * Where this card's objective text came from — the delivery gate's real trust axis (see
		 * `card-delivery-trust.ts`). ABSENT on legacy cards and resolves UNTRUSTED, so an unstamped board keeps
		 * exactly today's fail-closed behavior.
		 */
		trustedOrigin: z.enum(["operator", "plan", "external"]).optional(),
		/** Deterministic control-plane card that replaces only stranded nodes in an existing plan. */
		fleetReshardRequest: runtimeFleetReshardRequestSchema.optional(),
		// §5.AU: the stream/epic this card belongs to (single-parent). Additive optional (CRDT whole-object LWW) so older
		// boards load as-is; a manual `set_card_stream` override wins over the derived membership (see `deriveStreams`).
		streamId: z.string().optional(),
		// §5.AB re-decompose rung (David 2026-08-12): a `redecompose-<parent>` card carries its parked parent's id
		// TYPED (never re-parsed from the id string), so the decompose apply can convert that parent into an
		// integration card gated on the children. Additive optional (CRDT whole-object LWW).
		redecomposeOf: z.string().optional(),
		// How many review-driven decompose generations sit above this card (0/absent = an original card; a
		// redecompose card and the children it produces carry parent+1). Read by the re-decompose rung's depth
		// guard so a stubborn objective fragments at most REVIEW_REDECOMPOSE_GENERATION_CAP times, then parks.
		decomposeGeneration: z.number().int().nonnegative().optional(),
		blockedKind: z.enum(["needs_decomposition", "local_model_required", "agent_sandbox_unavailable"]).optional(),
		blockedReason: z.string().optional(),
		// blockedKind enforcement (David 2026-08-12): the loaded-fleet fingerprint at STAMP time, written by the
		// reshard's needs_decomposition writer — the auto-clear releases the card when the fleet changes AGAIN
		// (re-evaluate by unblocking; a still-unfit card gets re-stamped by the same path that stamped it).
		blockedFleetFingerprint: z.string().optional(),
		nkleinProviderId: z.string().optional(),
		nkleinModelId: z.string().optional(),
		nkleinReasoningEffort: runtimeLegacyTaskNKleinReasoningEffortSchema.optional(),
		baseRef: z.string(),
		createdAt: z.number(),
		updatedAt: z.number(),
	})
	.transform(
		({
			nkleinProviderId: _legacyProviderId,
			nkleinModelId: _legacyModelId,
			nkleinReasoningEffort: _legacyReasoningEffort,
			...card
		}) => {
			const nkleinSettings = normalizeRuntimeTaskNKleinSettings({
				nkleinSettings: card.nkleinSettings,
				nkleinProviderId: _legacyProviderId,
				nkleinModelId: _legacyModelId,
				nkleinReasoningEffort: _legacyReasoningEffort,
			});
			return {
				...card,
				...(nkleinSettings !== undefined ? { nkleinSettings } : {}),
				title: resolveTaskTitle(card.title, card.prompt),
			};
		},
	);
export type RuntimeBoardCard = z.infer<typeof runtimeBoardCardSchema>;

export const runtimeBoardColumnSchema = z.object({
	id: runtimeBoardColumnIdSchema,
	title: z.string(),
	cards: z.array(runtimeBoardCardSchema),
});
export type RuntimeBoardColumn = z.infer<typeof runtimeBoardColumnSchema>;

export const runtimeBoardDependencySchema = z.object({
	id: z.string(),
	fromTaskId: z.string(),
	toTaskId: z.string(),
	createdAt: z.number(),
});
export type RuntimeBoardDependency = z.infer<typeof runtimeBoardDependencySchema>;

/**
 * Edge-semantics slice (audit 2026-08-12): a dependency edge whose lifecycle ENDED — the prerequisite completed
 * (`released_by: "completed"` — the decision-handoff's source of truth) or was trashed, or the DEPENDENT reached a
 * terminal lane first (`"dependent_terminal"`, edge moot). Kept on the board instead of being DELETED (the old
 * silent prune), because erasing satisfied edges erased the facts every context assembler needed: the F12.38
 * dependency handoff was 100% dark and reviewers never saw a completed prerequisite. Additive + optional.
 */
export const runtimeSatisfiedDependencySchema = z.object({
	id: z.string(),
	fromTaskId: z.string(),
	toTaskId: z.string(),
	createdAt: z.number(),
	releasedAt: z.number(),
	releasedBy: z.enum(["completed", "trashed", "dependent_terminal"]),
});
export type RuntimeSatisfiedDependency = z.infer<typeof runtimeSatisfiedDependencySchema>;

/**
 * §5.AU — a STREAM/epic: a named grouping above cards (seeded from a decomposition `planSlug` or a `dependsOn` component
 * by `deriveStreams`, or created manually). Additive; `board.streams` defaults to `[]` so older boards load unchanged.
 * Status/health/progress are NOT stored — they are always derived (`deriveStreamRollup`) from the member cards.
 */
export const runtimeStreamSchema = z.object({
	id: z.string(),
	title: z.string(),
	source: z.enum(["decomposition", "manual", "dependency"]),
	/** Back-link to the seeding decomposition slug (only for `decomposition` streams). */
	planSlug: z.string().optional(),
	archived: z.boolean().optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export type RuntimeStream = z.infer<typeof runtimeStreamSchema>;

export const runtimeBoardDataSchema = z.object({
	columns: z.array(runtimeBoardColumnSchema),
	dependencies: z.array(runtimeBoardDependencySchema).default([]),
	// §5.AU: the board's streams/epics. Additive + OPTIONAL (not `.default([])`) so older persisted boards AND every
	// existing `RuntimeBoardData` constructor load unchanged; readers coalesce `board.streams ?? []`.
	streams: z.array(runtimeStreamSchema).optional(),
	// Edge-semantics slice: retired edges (prerequisite completed/trashed, or dependent terminal). Additive +
	// OPTIONAL for the same constructor-compatibility reason; readers coalesce `?? []`.
	satisfiedDependencies: z.array(runtimeSatisfiedDependencySchema).optional(),
});
export type RuntimeBoardData = z.infer<typeof runtimeBoardDataSchema>;
