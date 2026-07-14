/**
 * §5.AA — the thin JSON persistence layer for the {@link ModelBehaviorProfile} (the pure learning core is in
 * [model-behavior-profile.ts](../core/model-behavior-profile.ts)). Mirrors [model-performance-stats.ts] exactly:
 * EVENT-SOURCED — one append-only JSONL line per attempt OUTCOME under `<runtimeHome>/model-behavior/<date>.jsonl`,
 * folded back into a profile ON READ via the core's pure `recordModelBehaviorOutcome`. Append-only ⇒ concurrency-safe
 * across parallel sessions (no read-modify-write race, unlike a single keyed JSON blob); folding on read reuses the one
 * tested learning rule (no parallel aggregation logic to drift). The fold is EWMA and therefore ORDER-DEPENDENT, so
 * outcomes are replayed OLDEST-FIRST with each step stamped at the outcome's own `recordedAt`.
 *
 * The runtime wires this (separate integration): the attempt loop reads a model's profile to choose the best first
 * approach + skip known-failing rungs, and appends each attempt's outcome here. Built store-first (no consumers yet) so
 * the schema is real + tested before wiring.
 */
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { type AgentLedgerEvent, selectAttempts } from "../core/agent-attempt-ledger";
import {
	emptyModelBehaviorProfile,
	type ModelAttemptOutcome,
	type ModelBehaviorProfile,
	recordModelBehaviorOutcome,
} from "../core/model-behavior-profile";
import { parseJsonLineWithSchema } from "../core/parse-json-line";
import { readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { resolveStableRoutingModelId } from "../state/runtime-id-model-key-map-store";

const DEFAULT_MODEL_BEHAVIOR_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "model-behavior");

/** One persisted attempt: the canonical model key + the outcome the core folds + when it happened. */
const persistedBehaviorOutcomeSchema = z.object({
	modelId: z.string().min(1),
	recordedAt: z.number().finite(),
	outcome: z.object({
		kind: z.enum(["success", "no_tool_call", "narrated", "loop", "timeout", "malformed", "aborted", "other_failure"]),
		retries: z.number().finite().optional(),
		contextTokens: z.number().finite().optional(),
		qualityOk: z.boolean().optional(),
		toolCallFormat: z.string().optional(),
		toolCount: z.number().finite().optional(),
		promptVariantFamily: z.string().optional(),
		winningEndpointKind: z.string().optional(),
	}),
});
type PersistedBehaviorOutcome = z.infer<typeof persistedBehaviorOutcomeSchema>;

export interface ModelBehaviorStoreOptions {
	/** Override the store root (tests). Defaults to `<runtimeHome>/model-behavior`. */
	rootDir?: string;
	/** EWMA smoothing forwarded to the core fold (0..1). Omit for the core default (0.3). */
	alpha?: number;
}

function resolveRoot(rootDir?: string): string {
	return rootDir ?? DEFAULT_MODEL_BEHAVIOR_ROOT;
}

/** Append one attempt outcome for a model to the append-only log (creates the root on first write). */
export async function persistModelBehaviorOutcome(
	modelId: string,
	outcome: ModelAttemptOutcome,
	options: { rootDir?: string; now?: number } = {},
): Promise<void> {
	const trimmed = modelId.trim();
	if (trimmed.length === 0) {
		return; // no canonical key ⇒ nothing to attribute the outcome to.
	}
	const root = resolveRoot(options.rootDir);
	await mkdir(root, { recursive: true });
	const recordedAt = options.now ?? Date.now();
	const record: PersistedBehaviorOutcome = { modelId: trimmed, recordedAt, outcome };
	await appendFile(
		join(root, `${new Date(recordedAt).toISOString().slice(0, 10)}.jsonl`),
		`${JSON.stringify(record)}\n`,
		"utf8",
	);
}

/** Read every persisted outcome across all log files, OLDEST-FIRST (the order the EWMA fold requires). */
async function readAllOutcomes(root: string): Promise<PersistedBehaviorOutcome[]> {
	const fileNames = (await readdir(root).catch(() => [])).filter((name) => name.endsWith(".jsonl")).sort();
	const outcomes: PersistedBehaviorOutcome[] = [];
	for (const fileName of fileNames) {
		const text = await readFile(join(root, fileName), "utf8").catch(() => "");
		for (const line of text.split("\n")) {
			if (!line) {
				continue;
			}
			const record = parseJsonLineWithSchema(line, persistedBehaviorOutcomeSchema);
			if (record) {
				outcomes.push(record);
			}
		}
	}
	return outcomes.sort((left, right) => left.recordedAt - right.recordedAt);
}

/** Fold a single model's persisted outcomes into its current learned profile (empty profile if it has none). */
export async function readModelBehaviorProfile(
	modelId: string,
	options: ModelBehaviorStoreOptions = {},
): Promise<ModelBehaviorProfile> {
	const outcomes = (await readAllOutcomes(resolveRoot(options.rootDir))).filter((entry) => entry.modelId === modelId);
	let profile = emptyModelBehaviorProfile(modelId);
	for (const entry of outcomes) {
		profile = recordModelBehaviorOutcome(profile, entry.outcome, {
			alpha: options.alpha,
			now: () => entry.recordedAt,
		});
	}
	return profile;
}

/** Fold ALL persisted outcomes into one profile per model — the cross-session learned view. */
export async function readAllModelBehaviorProfiles(
	options: ModelBehaviorStoreOptions = {},
): Promise<Record<string, ModelBehaviorProfile>> {
	const outcomes = await readAllOutcomes(resolveRoot(options.rootDir));
	const byModel: Record<string, ModelBehaviorProfile> = {};
	for (const entry of outcomes) {
		const previous = byModel[entry.modelId] ?? emptyModelBehaviorProfile(entry.modelId);
		byModel[entry.modelId] = recordModelBehaviorOutcome(previous, entry.outcome, {
			alpha: options.alpha,
			now: () => entry.recordedAt,
		});
	}
	return byModel;
}

// ---------------------------------------------------------------------------
// F1.15d — the COMBINED behavior read: persisted outcomes ⊕ ledger board attempts, ONE chronological fold.
// ---------------------------------------------------------------------------

/**
 * Map ledger BOARD attempts into fold-able outcomes. The F1.15a `difficulty` stamp is the cutover line (same rule
 * as fitness): pre-stamp board history reaches the fold only through the persisted store (whose redundant terminal
 * writer was removed with this read), post-stamp attempts only through the ledger — no run is folded twice. Chat
 * attempts (`flow` non-null) stay store-only for now: the chat writer records prompt-variant evidence the ledger
 * does not carry.
 */
function ledgerBoardAttemptOutcomes(events: readonly AgentLedgerEvent[]): PersistedBehaviorOutcome[] {
	return selectAttempts(events)
		.filter((attempt) => attempt.flow === null && attempt.difficulty !== null)
		.map((attempt) => ({
			modelId: attempt.modelId,
			recordedAt: attempt.recordedAt,
			outcome: {
				kind: attempt.outcome,
				retries: attempt.retriesBefore,
				...(attempt.contextTokens !== null ? { contextTokens: attempt.contextTokens } : {}),
				...(attempt.qualityOk !== null ? { qualityOk: attempt.qualityOk } : {}),
				...(attempt.toolSetOffered.length > 0 ? { toolCount: attempt.toolSetOffered.length } : {}),
			},
		}));
}

export interface CombinedModelBehaviorOptions extends ModelBehaviorStoreOptions {
	/** Override the ledger root (tests). Defaults to the runtime home's agent-attempt-ledger. */
	ledgerRootDir?: string;
}

async function readCombinedOutcomes(options: CombinedModelBehaviorOptions): Promise<PersistedBehaviorOutcome[]> {
	const [persisted, ledgerEvents] = await Promise.all([
		readAllOutcomes(resolveRoot(options.rootDir)),
		readAllAgentLedger(options.ledgerRootDir !== undefined ? { rootDir: options.ledgerRootDir } : undefined).catch(
			() => [],
		),
	]);
	// The EWMA fold is order-dependent: one merged, oldest-first stream through the same tested rule.
	return [...persisted, ...ledgerBoardAttemptOutcomes(ledgerEvents)].sort(
		(left, right) => left.recordedAt - right.recordedAt,
	);
}

/** F1.15d: one model's profile folded from BOTH evidence streams (persisted store ⊕ ledger board attempts). */
export async function readCombinedModelBehaviorProfile(
	modelId: string,
	options: CombinedModelBehaviorOptions = {},
): Promise<ModelBehaviorProfile> {
	const outcomes = (await readCombinedOutcomes(options)).filter((entry) => entry.modelId === modelId);
	let profile = emptyModelBehaviorProfile(modelId);
	for (const entry of outcomes) {
		profile = recordModelBehaviorOutcome(profile, entry.outcome, {
			alpha: options.alpha,
			now: () => entry.recordedAt,
		});
	}
	return profile;
}

/** F1.15d: every model's profile folded from BOTH evidence streams — the unified cross-session learned view. */
export async function readAllCombinedModelBehaviorProfiles(
	options: CombinedModelBehaviorOptions = {},
): Promise<Record<string, ModelBehaviorProfile>> {
	const outcomes = await readCombinedOutcomes(options);
	const byModel: Record<string, ModelBehaviorProfile> = {};
	for (const entry of outcomes) {
		// F2.21 (David 2026-07-14): fold the (time-ordered) outcome STREAM under the STABLE model identity, so two
		// runtime ids for one model combine into ONE profile at the stream level — the EWMA-safe merge (a profile
		// merge would be order-dependent and wrong). A no-op when the shared map has no entry for the id.
		const stableModelId = resolveStableRoutingModelId(entry.modelId).trim() || entry.modelId;
		const previous = byModel[stableModelId] ?? emptyModelBehaviorProfile(stableModelId);
		byModel[stableModelId] = recordModelBehaviorOutcome(previous, entry.outcome, {
			alpha: options.alpha,
			now: () => entry.recordedAt,
		});
	}
	return byModel;
}
