/**
 * N16 — detect an OPERATOR HOLD in a nightly run and assemble evidence that makes it reproducible. PURE core.
 *
 * A card held for the operator is not a defect: `nklein-sandbox-review-finalizer.ts` states the intent outright
 * — *"an explicit operator hold … a manual redrive starts cleanly"*. Attended, that is correct behaviour. In an
 * unattended nightly there is nobody to redrive, so the hold becomes an indefinite stall that takes its entire
 * dependent subtree with it.
 *
 * ── SO THIS DETECTS AND EVIDENCES; IT DOES NOT REMEDY ──
 * The right fix is per-case and is a product decision. What is general — and what cost hours on 2026-07-20 —
 * is assembling enough evidence to DECIDE. This core produces that, and deliberately returns no remedy: a
 * detector that also prescribes would quietly settle a question it is not entitled to settle, and the blanket
 * answer ("add a re-drive everywhere") is wrong for at least one existing hold (the self-improvement M4 hold,
 * where manual review IS the point).
 *
 * ── THE FIELD THAT DECIDES MOST CASES: `survivingArtefacts` ──
 * The first real instance held a card whose work was **entirely intact on a result branch** (7 files, +76/−143).
 * The hold's stated premise is that nothing may proceed *"as if a result branch existed"* — and one did. Whether
 * the artefact survived changes which remedy is even sensible, and it is the one fact a log line never carries.
 * A report that omits it sends someone to clone a retained HOME to answer a yes/no question.
 *
 * ── SEVERITY IS THE SUBTREE, NOT THE CARD ──
 * One held card reads as one problem. The first instance blocked **22 dependents**. Reporting the hold without
 * its subtree understates the cost by more than an order of magnitude, and the subtree size is what makes the
 * difference between "a card needs attention" and "the run is over".
 */

export type HoldReasonCode =
	| "workspace_disposed_before_capture"
	| "workspace_missing_before_capture"
	| "capture_unsettled"
	| "empty_patch_no_signoff"
	| "self_improvement_blocked"
	| "acceptance_redrive_failed"
	| "unknown";

export interface ProcessingChainStep {
	/** Raw log line, in run order — the chain a reader needs to reconstruct what the card did. */
	readonly line: string;
}

export interface SurvivingArtefact {
	readonly kind: "result_branch" | "patch_file" | "none";
	readonly ref: string;
	/** Free-form summary (e.g. a diffstat). Present so "was the work lost?" is answerable from the report. */
	readonly detail: string;
}

export interface OperatorHoldEvidence {
	readonly cardId: string;
	readonly reasonCode: HoldReasonCode;
	/** Cards blocked behind this one, transitively. THE severity number. */
	readonly blockedDependents: readonly string[];
	readonly processingChain: readonly ProcessingChainStep[];
	readonly survivingArtefacts: readonly SurvivingArtefact[];
	/** Seed + cell, so the run can be repeated. */
	readonly seed: string | null;
	readonly cellId: string;
	readonly summary: string;
}

/** Map a runtime log message to a reason CODE. A code is greppable and comparable; prose is neither. */
export function classifyHoldReason(message: string): HoldReasonCode {
	if (/workspace_disposed_before_capture/.test(message)) {
		return "workspace_disposed_before_capture";
	}
	if (/workspace_missing_before_capture/.test(message)) {
		return "workspace_missing_before_capture";
	}
	if (/capture has not settled/i.test(message)) {
		return "capture_unsettled";
	}
	if (/Empty-patch card .* held in Review/i.test(message)) {
		return "empty_patch_no_signoff";
	}
	if (/Self-improvement card .* held in Review/i.test(message)) {
		return "self_improvement_blocked";
	}
	if (/Acceptance-failure re-drive of .* failed/i.test(message)) {
		return "acceptance_redrive_failed";
	}
	return "unknown";
}

/** Transitive dependents of `cardId` — the cards that cannot proceed while it is held. */
export function collectBlockedDependents(
	cardId: string,
	edges: readonly { readonly fromTaskId: string; readonly toTaskId: string }[],
): string[] {
	const dependentsOf = new Map<string, string[]>();
	for (const edge of edges) {
		dependentsOf.set(edge.toTaskId, [...(dependentsOf.get(edge.toTaskId) ?? []), edge.fromTaskId]);
	}
	const blocked = new Set<string>();
	const queue = [cardId];
	while (queue.length > 0) {
		const next = queue.shift() as string;
		for (const dependent of dependentsOf.get(next) ?? []) {
			// The `has` check also terminates a dependency CYCLE rather than looping forever — a malformed graph
			// must not hang the reporter that exists to explain a stall.
			if (!blocked.has(dependent)) {
				blocked.add(dependent);
				queue.push(dependent);
			}
		}
	}
	return [...blocked].sort();
}

export function buildOperatorHoldEvidence(input: {
	readonly cardId: string;
	readonly holdMessage: string;
	readonly dependencyEdges: readonly { readonly fromTaskId: string; readonly toTaskId: string }[];
	readonly logLines: readonly string[];
	readonly survivingArtefacts: readonly SurvivingArtefact[];
	readonly seed: string | null;
	readonly cellId: string;
}): OperatorHoldEvidence {
	const reasonCode = classifyHoldReason(input.holdMessage);
	const blockedDependents = collectBlockedDependents(input.cardId, input.dependencyEdges);
	const processingChain = input.logLines
		.filter((line) => line.includes(input.cardId))
		.map((line) => ({ line: line.trim() }));

	const workSurvived = input.survivingArtefacts.some((artefact) => artefact.kind !== "none");

	return {
		cardId: input.cardId,
		reasonCode,
		blockedDependents,
		processingChain,
		survivingArtefacts: input.survivingArtefacts,
		seed: input.seed,
		cellId: input.cellId,
		summary: [
			`OPERATOR HOLD (${reasonCode}) on ${input.cardId} in cell ${input.cellId}.`,
			`This is NOT a defect — the hold is deliberate and correct when a person is present. Unattended there is nobody, so it stalls.`,
			`BLOCKED DEPENDENTS: ${blockedDependents.length}${blockedDependents.length > 0 ? ` (${blockedDependents.slice(0, 6).join(", ")}${blockedDependents.length > 6 ? ", …" : ""})` : ""} — this, not the single card, is the severity.`,
			workSurvived
				? `WORK SURVIVED: ${input.survivingArtefacts
						.filter((a) => a.kind !== "none")
						.map((a) => `${a.kind} ${a.ref} (${a.detail})`)
						.join("; ")}. A remedy that re-does the work would discard it.`
				: `NO SURVIVING ARTEFACT FOUND — the work may genuinely be lost, which changes which remedies are sensible.`,
			`REPRODUCE: cell ${input.cellId}, seed ${input.seed ?? "<unrecorded>"}. Processing chain: ${processingChain.length} line(s) retained below.`,
		].join("\n  "),
	};
}
