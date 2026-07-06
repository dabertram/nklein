import { buildPromptShellKey, type PromptSessionKind, type PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { computeSharedPrefixRatio, type PromptFragment } from "../core/prompt-fragment-assembly";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { now } from "./nklein-session-state";
import { buildSessionSystemPrompt } from "./nklein-session-system-prompt";

export interface AssembleSessionSystemPromptInput {
	taskId: string;
	modelId: string | null | undefined;
	/**
	 * §5.AQ warmth ledger: which prompt SHELL this assembly builds. Derived at the call sites (they know the
	 * task-id shape + the explicit-decomposition set) via `derivePromptSessionKind`; recorded per model so
	 * warmth-aware routing can match prospective starts against the shell each model last prefilled.
	 */
	sessionKind: PromptSessionKind;
	/** The HOST workspace root of the session — the workspace part of the recorded shell key. */
	workspacePath: string | null;
	basePrompt: string;
	/**
	 * True when `basePrompt` is the restructured SDK shell (cwd/date extracted into `sessionEnv`) — byte-stable
	 * per model+workspace. False for caller-supplied custom prompts, which still embed per-task content.
	 */
	baseIsStaticShell: boolean;
	planningPrompt?: string | null;
	efficiencyRules: string;
	temporalBlock: string;
	/** The home-agent sidebar append (per-session-kind, task-tier) — folded in here instead of raw concat. */
	homeAgentAppend?: string | null;
	/** The `<session>` cwd+date trailer extracted from the SDK base — see the fragment ordering note below. */
	sessionEnv?: string | null;
	/**
	 * §5.AE: skill-driven fragments (from the approved skill→fragment bridge — {@link buildSessionSkillFragments}).
	 * Appended and DEDUPED against the fixed keys below, so a skill declaring an already-injected fragment
	 * (efficiency_rules/temporal) never doubles it; today this only ever adds a `repo-map`. The assembler re-sorts
	 * by volatility, so these land in their correct churn bucket regardless of append position.
	 */
	skillFragments?: readonly PromptFragment[];
}

export interface PromptWarmthLedger {
	/**
	 * The live per-model prompt-SHELL key map (kind + workspace + model each model last prefilled) — read by
	 * warmth-aware routing (`applyWarmthPreference`) and exposed through the service's `getPromptWarmthLedger`. The
	 * ledger owns the writes; consumers only read it.
	 */
	readonly shellKeyByModelId: Map<string, PromptWarmthLedgerEntry>;
	/**
	 * Assemble the session system prompt (delegating byte-stable fragment ordering to the pure
	 * `buildSessionSystemPrompt`) and record the warmth bookkeeping: the previous-prompt byte map (for the
	 * prefix reuseRatio observation) and the shell-key ledger.
	 */
	assembleAndRecord(input: AssembleSessionSystemPromptInput): string;
}

/**
 * §5.U: the §5.AQ prompt-warmth ledger, extracted verbatim from InMemoryNKleinTaskSessionService. Owns the two
 * per-model prompt-state maps (the full-bytes map for reuse telemetry + the shell-key map for warmth-aware routing).
 * The byte-stability-critical fragment ordering + assembly stays in the pure, unit-tested `buildSessionSystemPrompt`;
 * this module keeps only the instance-stateful bookkeeping around it. Has NO service-collaborator dependencies.
 */
export function createPromptWarmthLedger(): PromptWarmthLedger {
	/** W2.3b: last assembled system prompt per model — the baseline for the prefix reuseRatio observation. */
	const lastAssembledSystemPromptByModelId = new Map<string, string>();
	/**
	 * §5.AQ (a)+(d): last prompt-SHELL key per model id (+ when) — the cache-warmth ledger. Where the map above
	 * holds the full prompt BYTES (reuse telemetry), this holds the shell IDENTITY (kind + workspace + model) the
	 * model last prefilled, which is what warmth-aware routing compares prospective starts against. Deterministic —
	 * we know every prompt we send, so no server probing is needed (see `src/core/cache-warmth.ts`).
	 */
	const shellKeyByModelId = new Map<string, PromptWarmthLedgerEntry>();

	function assembleAndRecord(input: AssembleSessionSystemPromptInput): string {
		// §5.U: the byte-stability-critical fragment ordering + assembly is the pure `buildSessionSystemPrompt`
		// (extracted + unit-tested); this keeps only the instance-stateful warmth-ledger bookkeeping below.
		const assembled = buildSessionSystemPrompt(input);
		const modelKey = input.modelId?.trim() || "(unconfigured)";
		const previous = lastAssembledSystemPromptByModelId.get(modelKey);
		lastAssembledSystemPromptByModelId.set(modelKey, assembled.text);
		// §5.AQ warmth ledger: record the shell identity this model is about to prefill (same modelKey normalization
		// as the byte map above, so the routing lookup and this record can never drift apart).
		shellKeyByModelId.set(modelKey, {
			shellKey: buildPromptShellKey({
				sessionKind: input.sessionKind,
				workspacePath: input.workspacePath?.trim() ?? "",
				modelId: modelKey,
			}),
			at: now(),
		});
		if (previous !== undefined) {
			// run42 (§5.BE) lesson: an IDENTICAL reassembly — the perfect cache hit, exactly what per-alias warm
			// rails produce card after card — was previously SILENT, making the best outcome invisible on the
			// scoreboard. Log both cases with the same category so reuse is measurable per model/alias.
			const identical = previous === assembled.text;
			const reuseRatio = identical ? 1 : computeSharedPrefixRatio(previous, assembled.text);
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: identical
					? `Prompt prefix reuse for ${modelKey}: 100% — byte-identical shell (perfect prefix-cache hit).`
					: `Prompt prefix reuse for ${modelKey}: ${(reuseRatio * 100).toFixed(0)}% of the new system prompt is byte-shared with the previous start.`,
				taskId: input.taskId,
				metadata: {
					category: "prompt_prefix_reuse",
					reuseRatio: Number(reuseRatio.toFixed(4)),
					identical,
					headPinnedVolatileKeys: assembled.headPinnedVolatileKeys,
				},
			});
		}
		return assembled.text;
	}

	return { shellKeyByModelId, assembleAndRecord };
}
