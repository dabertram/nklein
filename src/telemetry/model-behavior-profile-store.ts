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
import {
	emptyModelBehaviorProfile,
	type ModelAttemptOutcome,
	type ModelBehaviorProfile,
	recordModelBehaviorOutcome,
} from "../core/model-behavior-profile";
import { parseJsonLineWithSchema } from "../core/parse-json-line";

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
