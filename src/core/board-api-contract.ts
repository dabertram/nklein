import { z } from "zod";
import {
	agentDeliveryTierSchema,
	type RuntimeTaskNKleinSettings,
	runtimeAgentIdSchema,
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

export const runtimeGeneratedFromPlanSchema = z.object({
	artifactKind: z.enum(["decomposition", "buildout", "spec"]).default("decomposition"),
	planSlug: z.string().min(1),
	planTaskId: z.string().min(1),
	sourceTaskId: z.string().min(1).nullable().optional(),
});
export type RuntimeGeneratedFromPlan = z.infer<typeof runtimeGeneratedFromPlanSchema>;

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
});
export type RuntimeReviewRoundRecord = z.infer<typeof runtimeReviewRoundRecordSchema>;

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
	updatedAt: z.number(),
});
export type RuntimeCardReview = z.infer<typeof runtimeCardReviewSchema>;

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
		focusChain: runtimeFocusChainSchema.optional(),
		// Per-card delivery-autonomy override (todo §5.L): when set, wins over the project + global/role delivery
		// tier at the auto-delivery gate. Additive optional field (CRDT whole-object LWW), so older boards load as-is.
		deliveryTierOverride: agentDeliveryTierSchema.optional(),
		autoReviewEnabled: z.boolean().optional(),
		autoReviewMode: runtimeTaskAutoReviewModeSchema.optional(),
		autoReviewStatus: z.enum(["running", "failed"]).optional(),
		autoReviewMessage: z.string().optional(),
		images: z.array(runtimeTaskImageSchema).optional(),
		agentId: runtimeAgentIdSchema.optional(),
		nkleinSettings: runtimeTaskNKleinSettingsSchema.optional(),
		filesLikelyTouched: z.array(z.string()).optional(),
		generatedFromPlan: runtimeGeneratedFromPlanSchema.optional(),
		// §5.AU: the stream/epic this card belongs to (single-parent). Additive optional (CRDT whole-object LWW) so older
		// boards load as-is; a manual `set_card_stream` override wins over the derived membership (see `deriveStreams`).
		streamId: z.string().optional(),
		blockedKind: z.enum(["needs_decomposition", "local_model_required", "agent_sandbox_unavailable"]).optional(),
		blockedReason: z.string().optional(),
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
});
export type RuntimeBoardData = z.infer<typeof runtimeBoardDataSchema>;
