/**
 * The §5.AB "why this model for this task" inspectable reason (sub-deliverable #5) — a PURE projection of a task-start
 * model-selection decision into an operator-readable explanation: the task's estimated difficulty + context need, each
 * candidate's capability (registry score AND the §5.AF ledger-blended `observedCapability`), why each was kept or ruled
 * out (below the difficulty bar / window too small / busy), and which one won and why. Generic over a clean input the
 * caller maps its selection data into, so it is fully unit-testable and decoupled from the start-task-session internals.
 * The §5.AG escalation/health surfaces consume this so a routing choice is never a silent "the harness just picked one".
 */

/** A task-start routing decision kind (mirrors `NKleinTaskRoutingDecision.type`). */
export type ModelSelectionDecisionKind = "assign" | "route_up" | "decompose" | "escalate";

/** One candidate as seen by the selector, before the decision — enough to explain its fate. */
export interface ModelSelectionCandidateInput {
	modelKey: string;
	role?: string | null;
	/** The model registry's static/effective capability score (0–100). */
	registryCapability: number;
	/**
	 * The capability actually USED for routing after blending the §5.AF ledger-observed success rate (see
	 * `blendCapabilityWithLedgerEvidence`). Null when there was no ledger evidence (then the registry score was used).
	 */
	observedCapability?: number | null;
	/** How many real ledger runs backed `observedCapability` (0 = none → registry score governed). */
	ledgerSamples?: number;
	/** The model's effective context window in tokens. */
	contextWindow: number;
	/** Whether the model was free (not currently running a task) at selection time. */
	isFree?: boolean;
	/** Predicted wall-time in ms, when known (a speed tiebreaker). */
	predictedWallTimeMs?: number | null;
	/** §5.AB best-fit: the model's strength tags (e.g. `code`, `reasoning`) — what let it win the affinity tiebreaker. */
	affinityTags?: readonly string[];
}

export interface ModelSelectionReasonInput {
	/** The task's estimated difficulty (0–100), matched against each candidate's capability. */
	difficulty: number;
	/** The context tokens the task needs to fit, matched against each candidate's window. */
	requiredContextTokens: number;
	/** The routing decision that was taken. */
	decisionKind: ModelSelectionDecisionKind;
	/** The model that was selected (null for decompose/escalate — no model fit). */
	selectedModelKey?: string | null;
	/** The router's own one-line reason, carried through verbatim. */
	decisionReason?: string;
	/** §5.AB/§5.AE best-fit: the tags the CARD needs (from its resolved skills), matched against each candidate's tags. */
	taskAffinityTags?: readonly string[];
	/** Every candidate the selector considered. */
	candidates: readonly ModelSelectionCandidateInput[];
}

/** The capability that GOVERNED routing for a candidate — the blended score when ledger-backed, else the registry score. */
export function effectiveSelectionCapability(candidate: ModelSelectionCandidateInput): number {
	if (
		candidate.observedCapability !== undefined &&
		candidate.observedCapability !== null &&
		(candidate.ledgerSamples ?? 0) > 0
	) {
		return candidate.observedCapability;
	}
	return candidate.registryCapability;
}

export interface ModelSelectionCandidateExplanation extends ModelSelectionCandidateInput {
	/** The capability that governed routing (blended when ledger-backed, else registry). */
	effectiveCapability: number;
	/** Met BOTH the difficulty bar and the context-window need. */
	feasible: boolean;
	/** Was this the chosen model. */
	selected: boolean;
	/** Human-readable reasons it was ruled out (empty when feasible). */
	exclusions: string[];
	/** The candidate's tags that matched the task's needed tags (§5.AB best-fit) — why it won/placed on affinity. */
	affinityMatchTags: string[];
}

/** The candidate tags that also appear in the task's needed tags (the affinity overlap the router ranks on). */
function computeAffinityMatchTags(
	candidateTags: readonly string[] | undefined,
	taskTags: readonly string[] | undefined,
): string[] {
	if (!candidateTags || candidateTags.length === 0 || !taskTags || taskTags.length === 0) {
		return [];
	}
	return candidateTags.filter((tag) => taskTags.includes(tag));
}

export interface ModelSelectionReason {
	difficulty: number;
	requiredContextTokens: number;
	decisionKind: ModelSelectionDecisionKind;
	selectedModelKey: string | null;
	/** A one-line operator summary of the whole decision. */
	summary: string;
	/** Per-candidate explanation, sorted: selected first, then feasible by effective capability desc, then ruled-out. */
	candidates: ModelSelectionCandidateExplanation[];
}

/** Explain a model-selection decision (pure). Computes per-candidate feasibility + exclusions and an overall summary. */
export function explainModelSelection(input: ModelSelectionReasonInput): ModelSelectionReason {
	const selectedKey = input.selectedModelKey ?? null;
	const explained: ModelSelectionCandidateExplanation[] = input.candidates.map((candidate) => {
		const effectiveCapability = effectiveSelectionCapability(candidate);
		const exclusions: string[] = [];
		if (effectiveCapability < input.difficulty) {
			exclusions.push(
				`capability ${Math.round(effectiveCapability)} below task difficulty ${Math.round(input.difficulty)}`,
			);
		}
		if (candidate.contextWindow < input.requiredContextTokens) {
			exclusions.push(
				`context window ${candidate.contextWindow} below the ${input.requiredContextTokens} tokens the task needs`,
			);
		}
		return {
			...candidate,
			effectiveCapability,
			feasible: exclusions.length === 0,
			selected: candidate.modelKey === selectedKey,
			exclusions,
			affinityMatchTags: computeAffinityMatchTags(candidate.affinityTags, input.taskAffinityTags),
		};
	});
	explained.sort((left, right) => {
		if (left.selected !== right.selected) {
			return left.selected ? -1 : 1;
		}
		if (left.feasible !== right.feasible) {
			return left.feasible ? -1 : 1;
		}
		return right.effectiveCapability - left.effectiveCapability || left.modelKey.localeCompare(right.modelKey);
	});
	return {
		difficulty: input.difficulty,
		requiredContextTokens: input.requiredContextTokens,
		decisionKind: input.decisionKind,
		selectedModelKey: selectedKey,
		summary: buildSummary(input, explained),
		candidates: explained,
	};
}

function buildSummary(
	input: ModelSelectionReasonInput,
	explained: readonly ModelSelectionCandidateExplanation[],
): string {
	const feasibleCount = explained.filter((candidate) => candidate.feasible).length;
	const head = `Task difficulty ${Math.round(input.difficulty)}, needs ${input.requiredContextTokens} ctx tokens; ${feasibleCount}/${explained.length} models feasible.`;
	if (input.decisionKind === "decompose") {
		return `${head} No single model fits — decompose the task. ${input.decisionReason ?? ""}`.trim();
	}
	if (input.decisionKind === "escalate") {
		return `${head} No connected model is capable/large enough — escalate. ${input.decisionReason ?? ""}`.trim();
	}
	const selected = explained.find((candidate) => candidate.selected);
	if (!selected) {
		return `${head} ${input.decisionReason ?? ""}`.trim();
	}
	const evidence =
		(selected.ledgerSamples ?? 0) > 0 && selected.observedCapability != null
			? `ledger-blended capability ${Math.round(selected.effectiveCapability)} (${selected.ledgerSamples} run(s))`
			: `registry capability ${Math.round(selected.effectiveCapability)}`;
	const verb = input.decisionKind === "route_up" ? "routed up to" : "selected";
	const affinity =
		selected.affinityMatchTags.length > 0 ? `, best-fit for [${selected.affinityMatchTags.join(", ")}]` : "";
	return `${head} ${verb} ${selected.modelKey} — ${evidence}, window ${selected.contextWindow}${affinity}${selected.isFree === false ? " (busy)" : ""}.`;
}

/** Render a selection reason as a plain-text block (CLI / log / tooltip). */
export function renderModelSelectionReason(reason: ModelSelectionReason): string {
	const lines: string[] = [reason.summary, ""];
	for (const candidate of reason.candidates) {
		const marker = candidate.selected ? "→" : candidate.feasible ? "·" : "✗";
		const cap =
			(candidate.ledgerSamples ?? 0) > 0 && candidate.observedCapability != null
				? `cap ${Math.round(candidate.effectiveCapability)} (ledger n=${candidate.ledgerSamples}, registry ${Math.round(candidate.registryCapability)})`
				: `cap ${Math.round(candidate.registryCapability)}`;
		const detail = candidate.exclusions.length > 0 ? ` — ruled out: ${candidate.exclusions.join("; ")}` : "";
		const affinity =
			candidate.affinityMatchTags.length > 0 ? ` best-fit[${candidate.affinityMatchTags.join(",")}]` : "";
		lines.push(`${marker} ${candidate.modelKey} [${cap}, window ${candidate.contextWindow}]${affinity}${detail}`);
	}
	return lines.join("\n");
}
