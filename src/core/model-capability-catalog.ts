import { MODEL_CAPABILITY_CATALOG } from "./model-capability-catalog-data.js";
import { normalizeModelId } from "./model-identity.js";

/**
 * Persistent model-capability catalog (todo §5.AL) — !Klein's curated, checked-in knowledge of which local
 * models are actually suited to our use cases (above all: TOOL CALLING and multi-step agentic tool chains).
 *
 * Why a catalog at all: "the model is loaded" tells us nothing about whether it can DO the job. Some popular
 * small models are reasoning-only (Phi-4-mini-reasoning, Phi-4-reasoning-plus, Magistral) or chat-only
 * (Gemma 2/3) and were never trained for function calling; others advertise tool use yet ship it broken in
 * the quantized artifacts (DeepSeek-R1 distill) or degrade hard on multi-step chains at small sizes
 * (Qwen3-8B, Nemotron-Nano). Letting a user unknowingly drive !Klein with one of these wastes a long run on
 * a guaranteed failure. So we keep a curated verdict per model family, sourced from vendor model cards +
 * community reports AND hardened by our own empirical sweeps, and gate on it before use.
 *
 * This catalog is INTENTIONALLY code (persistent, shipped with !Klein, reviewed in diffs). The working-mode
 * rule (goal.md / todo.md §4A) is: whenever a sweep or live run surfaces a new capability fact about a model,
 * ADD it here — flip a verdict, append a note, cite the source. The catalog is a living artifact.
 *
 * The matching layer ({@link lookupModelCapability}) is deliberately family-level (regex on the normalized
 * id) so a new quant / served-alias of a known family (`phi-4-mini-instruct@8bit`, `google/gemma-4-e2b`,
 * `qwen/qwen3-8b`) resolves without a new entry. The suitability layer ({@link assessModelSuitability})
 * maps a verdict + the active policy (warn vs reject; global default with a project override) to an action.
 */

/** Tool-use capability bucket for a model family — the headline axis we gate on (see module doc for sources). */
export type ToolUseVerdict =
	/** Explicitly trained/fine-tuned for tool/function calling; reliable at the family's size class. */
	| "TOOL_NATIVE"
	/** Tool calling works but isn't a headline feature; may need a matched parser/template. */
	| "TOOL_CAPABLE"
	/** Community/empirical reports of unreliable tool use (leaks calls into text, breaks on multi-tool). */
	| "TOOL_WEAK"
	/** Not trained for tool use (reasoning-/chat-only) or ships it broken — avoid for agentic tool chains. */
	| "TOOL_UNSUITABLE"
	/** No reliable information found — neither the catalog nor empirical data covers this model yet. */
	| "UNKNOWN";

/** What we primarily designed/tested the model for — context for the verdict (reasoning-only is the classic trap). */
export type ModelKind = "instruct" | "agentic" | "code" | "reasoning" | "chat" | "roleplay" | "unknown";

/**
 * MULTI-STEP tool-chaining strength — the key AGENTIC axis, distinct from the headline {@link ToolUseVerdict}:
 * `toolUse` says "can it call a tool at all?"; this says "can it SUSTAIN a read→command→create→… chain?". Small
 * models routinely pass single-tool yet drop the chain, so this is the perspective that predicts an unattended run.
 * `native` = holds the chain on its own; `via_force` = only completes it under !Klein's §5.AB force-advance scaffold
 * (default-on for reasoning on the stuck branch); `single_only` = one tool then stops; `fails` = never chains.
 */
export type ChainingStrength = "native" | "via_force" | "single_only" | "fails" | "unknown";

/**
 * Final-answer SYNTHESIS quality — a SEPARATE perspective from whether the tool CHAIN ran: a model can execute every
 * tool and persist state yet under-summarize in its reply (live 2026-07-01: the 4B coder echoed the result marker =
 * `full`; the reasoning models drove the chain but their final reply didn't reflect it = `weak`). Matters for
 * user-facing answer quality even when the agentic work succeeded.
 */
export type SynthesisQuality = "full" | "weak" | "unknown";

/**
 * How the model does FORCED structured output — a distinct lever from free-form tool calling (§4A): reasoning models
 * DEAD-END on `response_format: json_schema` (the reasoning channel conflicts with the constrained decode), so for
 * them the working path is a native `tool_choice: required` call. `json_schema` = the json_schema path works;
 * `json_schema_deadend` = json_schema stalls/empties (use native tool calls instead); `native_tool_call` = structured
 * output is obtained via a forced tool call, not json_schema.
 */
export type StructuredOutputMode = "json_schema" | "json_schema_deadend" | "native_tool_call" | "unknown";

/**
 * Inference LATENCY class for agentic MULTI-TURN use — orthogonal to capability: a model can be fully tool-capable yet
 * too slow to drive a many-step chain interactively (live: the 27B is `slow`, the 4B `fast`). Informs §5.AB model
 * selection when several candidates all clear the capability bar.
 */
export type SpeedClass = "fast" | "medium" | "slow" | "unknown";

/** A curated knowledge record for one model family. `match` is tested (case-insensitively) against the normalized id. */
export interface ModelCapabilityEntry {
	/** Stable slug for the family (for telemetry / messages), e.g. `"phi-4-mini-reasoning"`. */
	family: string;
	/** Regex matched against the lowercased normalized model id; FIRST hit in the catalog wins (order specific→general). */
	match: RegExp;
	/** Headline tool-use verdict (see {@link ToolUseVerdict}). */
	toolUse: ToolUseVerdict;
	/** What the model is for — `reasoning`/`chat`/`roleplay` are the tool-use traps. */
	kind: ModelKind;
	/**
	 * OPTIONAL multi-step tool-CHAINING strength ({@link ChainingStrength}). Distinct from {@link toolUse}: that verdict
	 * answers "can it call a tool?", this answers "can it SUSTAIN a read→command→create→… chain?" — the single axis that
	 * best predicts an unattended agentic run (many models pass single-tool yet drop the chain). Descriptive metadata for
	 * §5.AB selection + operator visibility; does NOT gate on its own (see {@link assessModelSuitability}).
	 */
	chaining?: ChainingStrength;
	/**
	 * OPTIONAL final-answer SYNTHESIS quality ({@link SynthesisQuality}) — a SEPARATE perspective from whether the chain
	 * ran: does the reply coherently reflect the tool results, or under-summarize? Live 2026-07-01: the 4B coder = `full`,
	 * the reasoning models = `weak` (chain succeeded, final reply didn't echo it).
	 */
	synthesis?: SynthesisQuality;
	/**
	 * OPTIONAL forced-structured-output mode ({@link StructuredOutputMode}) — a distinct lever from free-form tool calls:
	 * per §4A, reasoning models DEAD-END on `response_format: json_schema`, so `native_tool_call` (tool_choice:required)
	 * is their working path. Records which structured-output path actually holds for the family.
	 */
	structuredOutput?: StructuredOutputMode;
	/**
	 * OPTIONAL inference LATENCY class ({@link SpeedClass}) for agentic multi-turn use — orthogonal to capability: a
	 * fully tool-capable model may still be too slow to drive a many-step chain interactively (the 27B is `slow`, the 4B
	 * `fast`). A §5.AB tie-breaker once several candidates clear the capability bar.
	 */
	speed?: SpeedClass;
	/** OPTIONAL resident FOOTPRINT in GB — the memory cost of keeping this model loaded (a §5.AB selection/packing input). */
	sizeGb?: number;
	/**
	 * OPTIONAL — the model BRINGS ITS OWN orchestration (§5.AB-F, 2026-07-01): it is RL-trained to AUTHOR its own scaffold
	 * (task plan / tool calls / error recovery) at inference — e.g. Ornith-1.0 (a self-scaffolding agentic coder). When
	 * `true`, !Klein should SOFTEN the §5.AB force-advance + decompose LESS (let it self-orchestrate; allow a warm-up turn +
	 * a larger budget to author its scaffold first). Descriptive handling metadata; does NOT gate on its own.
	 */
	selfScaffolding?: boolean;
	/** One-line, honest justification (the "why" a future reader / the user sees). */
	note: string;
	/** Source URLs (model cards / docs / community reports) backing the verdict. */
	sources: readonly string[];
	/**
	 * OPTIONAL hard override of the gate severity, for unsuitability the tool-use verdict alone misses — e.g.
	 * Nemotron-Mini is tool-trained on paper (TOOL_CAPABLE) but its 4k context is below our 32k floor, so it's a
	 * `reject` for agentic use regardless. When set, it wins over the verdict-derived severity.
	 */
	severityOverride?: SuitabilitySeverity;
	/** OPTIONAL extra disqualifiers surfaced in the message (e.g. "4k context below the 32k floor", "GGUF FC disabled"). */
	disqualifiers?: readonly string[];
	/** Provenance of the verdict — `research` (cards/reports), `empirical` (our sweeps), or `both`. */
	basis: "research" | "empirical" | "both";
	/** OPTIONAL confidence flag; `false` marks a verdict we haven't fully verified (e.g. a release past a knowledge cutoff). */
	verified?: boolean;
}

// The curated catalog DATA table lives in `./model-capability-catalog-data.ts` (§5.U data/logic split,
// 2026-07-07). Imported above for this module's own lookups; re-exported here so existing importers are unaffected.
export { MODEL_CAPABILITY_CATALOG };

/**
 * The user-editable overlay (§5.AL, David 2026-07-07 decision #1), registered from `model-catalog-overlay.json` at
 * startup and consulted BEFORE the shipped catalog — so a user can add a new model or override a shipped verdict
 * WITHOUT a code change or rebuild. Empty until {@link registerModelCatalogOverlay}.
 */
let modelCatalogOverlay: readonly ModelCapabilityEntry[] = [];

/**
 * Non-authoritative llmfit GitHub catalog supplement (§5.AB/§5.AL). Consulted AFTER the shipped empirical catalog so
 * llmfit can fill unknown model metadata, but can never replace a measured !Klein tool-use verdict.
 */
let modelCatalogLlmfitSupplement: readonly ModelCapabilityEntry[] = [];

/** Register the loaded overlay entries (see `model-catalog-overlay.ts`). Overlay entries win over the shipped catalog. */
export function registerModelCatalogOverlay(entries: readonly ModelCapabilityEntry[]): void {
	modelCatalogOverlay = entries;
}

/** Clear the registered overlay (fall back to the shipped catalog only) — used by tests and on reload. */
export function clearModelCatalogOverlay(): void {
	modelCatalogOverlay = [];
}

/** Register llmfit-derived catalog supplement entries. These are consulted only after the shipped catalog. */
export function registerModelCatalogLlmfitSupplement(entries: readonly ModelCapabilityEntry[]): void {
	modelCatalogLlmfitSupplement = entries;
}

/** Clear the llmfit-derived supplement (tests / cache reload fallback). */
export function clearModelCatalogLlmfitSupplement(): void {
	modelCatalogLlmfitSupplement = [];
}

/**
 * Snapshot the recommendation catalog used by read-only advice surfaces. This intentionally includes the user overlay
 * and the post-empirical llmfit supplement so fetched public metadata can suggest what to try next without changing the
 * authoritative lookup order or doing any network work at read time.
 */
export function getModelCapabilityRecommendationCatalog(): readonly ModelCapabilityEntry[] {
	return [...modelCatalogOverlay, ...MODEL_CAPABILITY_CATALOG, ...modelCatalogLlmfitSupplement];
}

/**
 * Look up the capability entry for a model id (served id or lms key, e.g. `phi-4-mini-instruct@8bit`,
 * `google/gemma-4-e2b`, `qwen/qwen3-8b`). The USER OVERLAY is consulted first (so a user entry overrides a shipped
 * one), then the shipped empirical catalog, then the non-authoritative llmfit supplement. Matches family patterns
 * case-insensitively; returns the FIRST hit (each list is ordered specific→general) or `null` when the family is unknown.
 */
export function lookupModelCapability(modelId: string): ModelCapabilityEntry | null {
	const id = normalizeModelId(modelId).toLowerCase();
	for (const entry of modelCatalogOverlay) {
		if (entry.match.test(id)) {
			return entry;
		}
	}
	for (const entry of MODEL_CAPABILITY_CATALOG) {
		if (entry.match.test(id)) {
			return entry;
		}
	}
	for (const entry of modelCatalogLlmfitSupplement) {
		if (entry.match.test(id)) {
			return entry;
		}
	}
	return null;
}

/** The gate action for a model: `ok` to use freely, `warn` to use with a caveat, `reject` to refuse, `unknown` = no data. */
export type SuitabilitySeverity = "ok" | "warn" | "reject" | "unknown";

/** How the active policy treats the two non-`ok` knowledge states. Default: reject the unsuitable, warn the unknown. */
export interface ModelSuitabilityPolicy {
	/** Action when the catalog says a model is TOOL_UNSUITABLE (default `reject`). */
	onUnsuitable: SuitabilitySeverity;
	/** Action when the model is UNKNOWN to the catalog (default `warn` — don't hard-block an unstudied model). */
	onUnknown: SuitabilitySeverity;
}

/** The shipped default policy (the user's chosen default): warn-and-reject not-suitable models right away. */
export const DEFAULT_MODEL_SUITABILITY_POLICY: ModelSuitabilityPolicy = {
	onUnsuitable: "reject",
	onUnknown: "warn",
};

/**
 * Merge a global policy with an OPTIONAL project-level override (the user's "global setting with project-level
 * override" requirement). Any field set on the override wins; unset fields inherit the global policy.
 */
export function resolveModelSuitabilityPolicy(
	global: ModelSuitabilityPolicy = DEFAULT_MODEL_SUITABILITY_POLICY,
	projectOverride?: Partial<ModelSuitabilityPolicy>,
): ModelSuitabilityPolicy {
	return {
		onUnsuitable: projectOverride?.onUnsuitable ?? global.onUnsuitable,
		onUnknown: projectOverride?.onUnknown ?? global.onUnknown,
	};
}

/** Parse a policy-action env value (`allow`/`ok` → ok, `warn`, `reject`); unrecognized/blank → null (use the default). */
function parsePolicyActionEnv(value: string | undefined): SuitabilitySeverity | null {
	switch ((value ?? "").trim().toLowerCase()) {
		case "allow":
		case "ok":
			return "ok";
		case "warn":
			return "warn";
		case "reject":
			return "reject";
		default:
			return null;
	}
}

/**
 * Resolve the ACTIVE suitability policy every gate consults (todo §5.AL settings). Priority, highest first:
 * **env override** (`NKLEIN_MODEL_GATE_UNSUITABLE` / `NKLEIN_MODEL_GATE_UNKNOWN`, each `allow`|`warn`|`reject`) →
 * **`base`** (the runtime-config effective policy: global default ← per-project override, supplied by task-start) →
 * **shipped default** (reject unsuitable / warn unknown). `base` uses the config action vocabulary (`allow` maps to the
 * gate's `ok`); unset/unrecognized values at any layer fall through. So the env is the always-available override on top
 * of whatever the project's runtime-config says.
 */
export function resolveActiveModelSuitabilityPolicy(
	env: Record<string, string | undefined> = process.env,
	base?: { onUnsuitable: string; onUnknown: string },
): ModelSuitabilityPolicy {
	const baseUnsuitable = base ? parsePolicyActionEnv(base.onUnsuitable) : null;
	const baseUnknown = base ? parsePolicyActionEnv(base.onUnknown) : null;
	return {
		onUnsuitable:
			parsePolicyActionEnv(env.NKLEIN_MODEL_GATE_UNSUITABLE) ??
			baseUnsuitable ??
			DEFAULT_MODEL_SUITABILITY_POLICY.onUnsuitable,
		onUnknown:
			parsePolicyActionEnv(env.NKLEIN_MODEL_GATE_UNKNOWN) ??
			baseUnknown ??
			DEFAULT_MODEL_SUITABILITY_POLICY.onUnknown,
	};
}

/** The outcome of gating a model: the action, a human-readable reason, and the catalog entry (if any). */
export interface ModelSuitabilityVerdict {
	modelId: string;
	severity: SuitabilitySeverity;
	/** True only when `severity === "ok"` — convenience for `if (!verdict.allowed) ...` call sites. */
	allowed: boolean;
	/** The headline tool-use verdict (or `UNKNOWN`). */
	toolUse: ToolUseVerdict;
	/** A one-paragraph, user-facing explanation incorporating the note, disqualifiers, and policy decision. */
	reason: string;
	/** The matched catalog entry, or `null` when the family is unknown. */
	entry: ModelCapabilityEntry | null;
}

/** Verdict → base gate severity, BEFORE policy is applied. Native/capable are fine; weak warns; the rest defer to policy. */
function baseSeverityForVerdict(verdict: ToolUseVerdict, policy: ModelSuitabilityPolicy): SuitabilitySeverity {
	switch (verdict) {
		case "TOOL_NATIVE":
		case "TOOL_CAPABLE":
			return "ok";
		case "TOOL_WEAK":
			return "warn";
		case "TOOL_UNSUITABLE":
			return policy.onUnsuitable;
		case "UNKNOWN":
			return policy.onUnknown;
	}
}

/**
 * Assess whether a model is suitable for agentic tool use under the active policy. This is the gate !Klein
 * consults before driving a model (load path, chat, agent loop). Unknown models defer to `policy.onUnknown`
 * (default `warn`) — paired with the §5.AL online-lookup task, an unknown model is a prompt to investigate,
 * not a silent pass.
 */
export function assessModelSuitability(
	modelId: string,
	policy: ModelSuitabilityPolicy = DEFAULT_MODEL_SUITABILITY_POLICY,
): ModelSuitabilityVerdict {
	const entry = lookupModelCapability(modelId);
	if (!entry) {
		const severity = policy.onUnknown;
		return {
			modelId,
			severity,
			allowed: severity === "ok",
			toolUse: "UNKNOWN",
			reason:
				`"${modelId}" is not in the model-capability catalog, so its tool-use reliability is unverified. ` +
				"Run a capability check (or a model sweep) before relying on it for agentic tool chains.",
			entry: null,
		};
	}
	const base = baseSeverityForVerdict(entry.toolUse, policy);
	// A per-entry severityOverride wins when it is STRICTER than the policy-derived base (so a project that loosens
	// onUnsuitable to "warn" still can't accidentally promote a hard disqualifier like Nemotron-Mini's 4k context).
	const severity = entry.severityOverride ? strictest(base, entry.severityOverride) : base;
	const disq =
		entry.disqualifiers && entry.disqualifiers.length > 0 ? ` Disqualifiers: ${entry.disqualifiers.join("; ")}.` : "";
	const unverified =
		entry.verified === false ? " (NOTE: this verdict is unverified — confirm against a live sweep.)" : "";
	return {
		modelId,
		severity,
		allowed: severity === "ok",
		toolUse: entry.toolUse,
		reason: `${entry.family} [${entry.toolUse}]: ${entry.note}${disq}${unverified}`,
		entry,
	};
}

/** Severity ordering for picking the stricter of two (reject > warn > unknown > ok). */
const SEVERITY_RANK: Record<SuitabilitySeverity, number> = { ok: 0, unknown: 1, warn: 2, reject: 3 };
function strictest(a: SuitabilitySeverity, b: SuitabilitySeverity): SuitabilitySeverity {
	return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** A roster recommendation tier (todo §5.AL — the catalog-side of the keep-list/drop-list). */
export interface CatalogRosterTier {
	/** `prefer` = drive agents with these · `caution` = works but flaky, use knowingly · `avoid` = not for tool chains. */
	tier: "prefer" | "caution" | "avoid";
	/** One-line rationale for the tier. */
	rationale: string;
	/** The catalog families in this tier (each with its headline verdict + note), sorted strongest-first. */
	families: readonly { family: string; toolUse: ToolUseVerdict; verified: boolean; note: string }[];
}

/**
 * Entry → roster tier reflecting EFFECTIVE suitability (so it matches the gate, not just the headline verdict): a hard
 * `severityOverride: "reject"` (e.g. Nemotron-Mini's 4k context) forces `avoid` even though its tool-use verdict is
 * TOOL_CAPABLE. Otherwise NATIVE/CAPABLE → prefer, WEAK/UNKNOWN → caution, UNSUITABLE → avoid.
 */
function rosterTierForEntry(entry: ModelCapabilityEntry): CatalogRosterTier["tier"] {
	if (entry.severityOverride === "reject") {
		return "avoid";
	}
	switch (entry.toolUse) {
		case "TOOL_NATIVE":
		case "TOOL_CAPABLE":
			return "prefer";
		case "TOOL_WEAK":
		case "UNKNOWN":
			return "caution";
		case "TOOL_UNSUITABLE":
			return "avoid";
	}
}

/** Strength order within a tier (best-in-class first), used to sort each tier's families. */
const VERDICT_STRENGTH: Record<ToolUseVerdict, number> = {
	TOOL_NATIVE: 0,
	TOOL_CAPABLE: 1,
	TOOL_WEAK: 2,
	UNKNOWN: 3,
	TOOL_UNSUITABLE: 4,
};

/**
 * Project the curated catalog into a tiered roster recommendation (todo §5.AL) — the catalog-side input to the
 * keep-list/drop-list: which model families to PREFER for agentic tool use, which to use with CAUTION (flaky), and
 * which to AVOID (not tool-capable). Pure over {@link MODEL_CAPABILITY_CATALOG}; refines automatically as verdicts are
 * corrected by live sweeps. The on-disk *variant* keep-list (which quant to keep/drop) layers download/size data on top.
 */
export function buildCatalogRosterRecommendation(
	catalog: readonly ModelCapabilityEntry[] = MODEL_CAPABILITY_CATALOG,
): CatalogRosterTier[] {
	const byTier: Record<CatalogRosterTier["tier"], CatalogRosterTier["families"][number][]> = {
		prefer: [],
		caution: [],
		avoid: [],
	};
	for (const entry of catalog) {
		byTier[rosterTierForEntry(entry)].push({
			family: entry.family,
			toolUse: entry.toolUse,
			verified: entry.verified !== false,
			note: entry.note,
		});
	}
	const sortStrongestFirst = (families: CatalogRosterTier["families"][number][]) =>
		[...families].sort(
			(a, b) => VERDICT_STRENGTH[a.toolUse] - VERDICT_STRENGTH[b.toolUse] || a.family.localeCompare(b.family),
		);
	return [
		{
			tier: "prefer",
			rationale: "Trained for / reliable at tool use — drive agents with these (best-in-class first).",
			families: sortStrongestFirst(byTier.prefer),
		},
		{
			tier: "caution",
			rationale: "Tool use is flaky or unverified (small-model chaining, reasoning distills) — use knowingly.",
			families: sortStrongestFirst(byTier.caution),
		},
		{
			tier: "avoid",
			rationale:
				"Not suited to agentic tool chains (reasoning-only / wrong context) — don't drive agents with these.",
			families: sortStrongestFirst(byTier.avoid),
		},
	];
}
