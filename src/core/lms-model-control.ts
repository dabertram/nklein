/**
 * Guarded model-load PLANNER + `lms` command builders (todo §5.AF / §5.AB — the 2026-06-29 "let !Klein manage models"
 * working-mode prep). This is the PURE planning layer over {@link decideModelLoad}: given a candidate model + the live
 * resident set + host RAM, it produces a load PLAN — either a refusal (with the headroom reason) or the exact `lms load`
 * argv to run. It does NOT spawn anything; the thin effectful runner (which actually invokes `lms`) consults this and is
 * the ONLY place a load happens, so autonomous loading can never bypass the freeze-avoidance guard.
 *
 * `lms load <id> [--context-length N] [--gpu max] [--ttl S] -y` / `lms unload <id>` are the LM Studio CLI verbs. Context
 * is set at load time and floored at the ≥32k invariant. Pure + deterministic → fully unit-testable.
 */

import { decideModelLoad, type LoadHeadroomInput, parseModelSizeBytes } from "./model-load-headroom";

/** One resident model parsed from `lms ps`. */
export interface ResidentModel {
	identifier: string;
	sizeBytes: number | null;
	contextLength: number | null;
	/**
	 * The LM Link device the model is resident on (the `lms ps` DEVICE column: "Local" | a linked device name like
	 * "m4mini"/"davidlegion5pro"); null when the column is absent (older `lms`). Lets the guard scope "unload others" to
	 * the SAME machine (todo §5.AB per-machine concurrency — an m5 load must never evict a model on another linked box).
	 */
	device: string | null;
}

/**
 * Parse `lms ps` table output into resident models — the adapter that feeds the headroom guard the live resident set +
 * sizes. Columns are multi-space-separated (the `SIZE` "4.37 GB" has a single inner space, so split on 2+ spaces keeps
 * it intact). Tolerant: skips the header + blank/short lines.
 */
export function parseLmsPs(text: string): ResidentModel[] {
	const models: ResidentModel[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.length === 0 || line.startsWith("IDENTIFIER")) {
			continue;
		}
		const cols = line.split(/\s{2,}/);
		// IDENTIFIER, MODEL, STATUS, SIZE, CONTEXT, [PARALLEL, DEVICE, TTL]
		if (cols.length < 5) {
			continue;
		}
		const [identifier, , , size, context] = cols;
		const contextLength = Number.parseInt(context, 10);
		// DEVICE is the 7th column (IDENTIFIER, MODEL, STATUS, SIZE, CONTEXT, PARALLEL, DEVICE[, TTL]); null on older
		// `lms` output that lacks it. Used to scope the one-at-a-time unload to a single machine.
		const device = cols.length >= 7 ? cols[6] : null;
		models.push({
			identifier,
			sizeBytes: parseModelSizeBytes(size),
			contextLength: Number.isFinite(contextLength) ? contextLength : null,
			device,
		});
	}
	return models;
}

/** The ≥32k context floor (invariant #3) — a guarded load never configures a smaller window. */
export const MIN_CONTEXT_WINDOW_TOKENS = 32_000;

export interface LmsLoadOptions {
	/** Context window to load with; floored to {@link MIN_CONTEXT_WINDOW_TOKENS} and capped to the model's capability. */
	contextLength?: number;
	/** The model's max context capability (from `/api/v0/models` `max_context_length`); caps `contextLength`. */
	maxContextLength?: number;
	/**
	 * GPU offload policy; default "max" (use the GPU fully on the unified-memory Mac). A NUMBER in [0,1] is a
	 * partial-offload ratio (clamped) — the key lever for a small-VRAM linked box (e.g. the Legion's 8 GB dGPU, where a
	 * 12–14B can't fully offload and must spill to system RAM). "auto" omits the flag so LM Studio auto-determines it.
	 */
	gpu?: "max" | "off" | "auto" | number;
	/** Auto-unload TTL in seconds (so a sweep-loaded model self-evicts if a step is abandoned). */
	ttlSeconds?: number;
	/**
	 * When true, append `--estimate-only`: LM Studio computes the (device-aware) resource estimate WITHOUT loading — the
	 * safe cross-machine fit pre-check for a linked box whose real RAM the host-side headroom math doesn't know.
	 */
	estimateOnly?: boolean;
}

/** Build the `lms load` argv for a model. Context is floored to the ≥32k invariant and capped to capability. */
export function buildLmsLoadArgs(modelId: string, options: LmsLoadOptions = {}): string[] {
	const args = ["load", modelId, "-y"];
	if (options.contextLength !== undefined) {
		// Floor to the ≥32k invariant, then cap to the model's capability when known.
		const floored = Math.max(MIN_CONTEXT_WINDOW_TOKENS, options.contextLength);
		const capped = options.maxContextLength !== undefined ? Math.min(floored, options.maxContextLength) : floored;
		args.push("--context-length", String(capped));
	}
	// GPU offload: a number is a partial-offload ratio (clamped to [0,1]); "auto" omits the flag (LM Studio decides);
	// otherwise pass the "max"/"off" keyword (default "max" — full offload on the unified-memory Mac).
	const gpu = options.gpu ?? "max";
	if (typeof gpu === "number") {
		args.push("--gpu", String(Math.max(0, Math.min(1, gpu))));
	} else if (gpu !== "auto") {
		args.push("--gpu", gpu);
	}
	if (options.ttlSeconds !== undefined && options.ttlSeconds > 0) {
		args.push("--ttl", String(Math.trunc(options.ttlSeconds)));
	}
	if (options.estimateOnly === true) {
		args.push("--estimate-only");
	}
	return args;
}

/** Build the `lms unload` argv for a model. */
export function buildLmsUnloadArgs(modelId: string): string[] {
	return ["unload", modelId];
}

export interface ModelLoadPlanInput extends LoadHeadroomInput {
	modelId: string;
	load?: LmsLoadOptions;
}

export type ModelLoadPlan =
	| { allow: true; modelId: string; argv: string[]; reason: string; freeBytesAfter: number }
	| { allow: false; modelId: string; reason: string; freeBytesAfter: number };

/**
 * Plan a guarded load: consult the headroom guard, and on approval return the exact `lms load` argv. On refusal return
 * the reason (so the caller unloads something / picks a smaller quant / asks the user) — never an argv, so a refused
 * load cannot be run by mistake.
 */
export function planGuardedModelLoad(input: ModelLoadPlanInput): ModelLoadPlan {
	const decision = decideModelLoad(input);
	if (!decision.allow) {
		return { allow: false, modelId: input.modelId, reason: decision.reason, freeBytesAfter: decision.freeBytesAfter };
	}
	return {
		allow: true,
		modelId: input.modelId,
		argv: buildLmsLoadArgs(input.modelId, input.load),
		reason: decision.reason,
		freeBytesAfter: decision.freeBytesAfter,
	};
}
