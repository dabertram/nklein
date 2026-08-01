/**
 * Which attempt-ledger FIELDS are actually carrying data — and which are silently dead. PURE core.
 *
 * ── WHY THIS EXISTS ──
 * !Klein's whole discipline is evidence over intuition: `insufficient_data`, `no_held_out_measurement`,
 * `unknown_enablement`. **Every one of those honest refusals is computed from the attempt ledger, and the ledger
 * itself had never been audited.** Two corruptions were found in it on 2026-07-31 — a phantom model on 29% of
 * attempts, and tool calls duplicated once per restart — both by accident, neither with a test.
 *
 * A field that is never populated does not fail. **A projection over an all-null field returns a clean empty
 * result**, so `summarizeModelSpeed` reports "no timing samples" and looks correct while being structurally
 * incapable of ever reporting one.
 *
 * ── THE DISTINCTION THIS EXISTS TO MAKE, AND WHY EYEBALLING IT FAILED ──
 * The mechanism registry already separates `never_enabled` ("zero is the CORRECT result, not a smell") from
 * `enabled_but_silent` (actionable). **Nobody had applied that reasoning to the ledger's fields**, and doing it by
 * hand immediately produced a wrong answer: `flow` is 0/238 and looks broken, but null IS the encoding for
 * `board` — `summarizeModelOutcomesByFlow` reads `attempt.flow ?? "board"`, and only the chat writer stamps it.
 * Meanwhile `ttftMs` is 0/238 and genuinely broken. Same number, opposite meanings.
 *
 * So the expectation is DECLARED per field, next to the consumer that gives it a reason to exist. An emptiness
 * nobody predicted is a finding; an emptiness the design requires is not.
 */

export type LedgerFieldExpectation =
	/** The live writer must populate this on every attempt. Zero ⇒ actionable. */
	| "always"
	/** Fires only on a rare path (a timeout, a recovery rung). Sparse IS health. */
	| "exceptional"
	/** Present only when the endpoint reports it. Zero says something about the fleet, not the code. */
	| "provider_reported"
	/** `null` carries meaning — absence is a value, not a gap. */
	| "null_encodes_default"
	/** Populated only when a named flag is on. Zero with the flag off is the CORRECT result. */
	| "flag_gated"
	/**
	 * INVESTIGATED and confirmed unpopulated, but the fix needs a capability that does not exist — an evaluator,
	 * a first-token signal — rather than a wire.
	 *
	 * ── WHY THIS IS NOT JUST `always` WITH A SAD NOTE ──
	 * Leaving a verdicted field as `silent` keeps the exit code non-zero forever over gaps nobody can close this
	 * week, and **a check that fails permanently is a check people stop reading** — the same cries-wolf failure
	 * this module's command guards against by reporting only EMPTY undeclared fields. The actionable class must
	 * stay small enough to act on. `blocked_on_capability` still prints, still says what is missing, and still
	 * shows the count; it just stops claiming someone forgot to plug something in.
	 */
	| "needs_capability"
	/**
	 * Added so recently that no attempt has been written since. Zero says nothing yet.
	 *
	 * Mirrors the mechanism registry's `too_new_to_judge`, and exists for the same reason: without it a field
	 * added today is indistinguishable from one broken for months, and the only two options are a false alarm or
	 * silently not checking it — the second being how a field stops being audited forever.
	 */
	| "newly_added";

export interface LedgerFieldSpec {
	readonly field: string;
	readonly expectation: LedgerFieldExpectation;
	/** Who READS it. A field with no consumer is a different problem; this one is about broken supply. */
	readonly consumer: string;
	readonly note: string;
	/** For `flag_gated` — the env flag that turns population on. */
	readonly flag?: string;
}

/**
 * What each attempt field is SUPPOSED to do.
 *
 * Deliberately not exhaustive over the schema: a field is listed once someone has actually traced its writer and
 * its reader. **An unverified entry would be a guess wearing the authority of a registry**, which is the failure
 * this module exists to catch, so unlisted fields are reported as `undeclared` rather than assumed healthy.
 */
export const LEDGER_FIELD_REGISTRY: readonly LedgerFieldSpec[] = [
	{
		field: "modelId",
		expectation: "always",
		consumer: "every per-model rollup (fitness, behaviour profile, edit reliability, routing evidence)",
		note: "the attempt's primary key; an unresolvable one is refused at the ledger door",
	},
	{
		field: "endpoint",
		expectation: "always",
		consumer: "endpoint-scoped rollups + shared-endpoint serialization",
		note: "assigned at dispatch, so a live attempt always has one. A PARTIAL count on historical data is explained: the 70 unattributable attempts (now refused at the ledger door) carried no endpoint either",
	},
	{
		field: "tokensPerSec",
		expectation: "provider_reported",
		consumer: "summarizeModelSpeed",
		note: "computed by the terminal writer from usage + wall time; needs the server to have reported usage",
	},
	{
		field: "ttftMs",
		expectation: "needs_capability",
		consumer: "summarizeModelSpeed (medianTtftMs)",
		note: "UNMEASURABLE with what the runtime exposes: the extension has only beforeModel/afterModel so the measurable quantity is FULL request duration, not time-to-first-token; the SDK's assistantMessage.metrics carries token counts only; and parseLmStudioRequestStats (which does parse time_to_first_token) is reachable solely from a dev command. Needs a first-token signal — a feature, not a wire. Its consumer's doc CLAIMED the terminal writer computed it; that false claim was corrected 2026-08-01",
	},
	{
		field: "qualityScore",
		expectation: "needs_capability",
		consumer: "stubborn-failure-escalation",
		note: 'needs a real EVALUATOR: `qualityOk` is literally `outcome === "success"`, and the consumer (pickBestPartial) matters precisely where EVERY attempt failed — so an outcome-derived number is constant across the candidates it must rank. Grading how much of the task got done is not a field to plumb',
	},
	{
		field: "endpointStrategy",
		expectation: "needs_capability",
		consumer: "agent-ledger-projections — retained as a redundant fallback; NOTHING depends on it since 2026-08-01",
		note: "no producer anywhere in src/. Its null used to make `inferAttemptStrategy` take a wrong branch and report a cross-model retry as `same_model_retry` INTO THE MODEL'S PROMPT; that reader now reads the strategy from where it actually lives, so this field is redundant rather than load-bearing",
	},
	{
		field: "toolSetOffered",
		expectation: "newly_added",
		consumer: "agent-ledger-projections + the §5.AA model-behaviour profile (toolCount)",
		note: "WRITER ADDED 2026-08-01 (P21.15): the extension records the post-transform, SDK-complete offered set; the runtime translates task→session; the terminal write reads it. Zero until the first attempt written after that change",
	},
	{
		field: "transcriptToolCallCount",
		expectation: "newly_added",
		consumer: "the next attempt's tool-call delta (P21.14)",
		note: "added 2026-07-31; zero until the first attempt is written after that change",
	},
	{
		field: "flow",
		expectation: "null_encodes_default",
		consumer: "summarizeModelOutcomesByFlow",
		note: "the consumer reads `attempt.flow ?? 'board'`; only the chat writer stamps it, so null on a board attempt is correct",
	},
	{
		field: "reasoningTokens",
		expectation: "provider_reported",
		consumer: "fitness rollups (which keep null and 0 apart)",
		note: "null when the server reported no breakdown — a statement about the fleet, not the code",
	},
	{
		field: "surfacedSkillIds",
		expectation: "flag_gated",
		consumer: "F12.29 paired-trajectory auditing",
		flag: "NKLEIN_PROCEDURAL_SKILLS",
		note: "stamped only when procedural skills are surfaced into the prompt",
	},
	{
		field: "parentAttemptId",
		expectation: "exceptional",
		consumer: "otel-genai-export (parentSpanId) — reachable only from `dev otel-export`",
		note: "null is CORRECT for a root attempt, and the consumer guards on it. But nothing records retry PARENTAGE either, so a retry chain renders as flat sibling spans rather than a chain. Left alone pending the OTel cluster decision (11 packages, zero first-party imports) — building span parentage on an undecided dependency is premature",
	},
	{
		field: "promptStrategy",
		expectation: "exceptional",
		consumer: "recovery-rung analysis",
		note: "set only when a recovery rung produced the attempt; null on a baseline try",
	},
	{
		field: "salvage",
		expectation: "exceptional",
		consumer: "timeout/salvage breakdowns",
		note: "carries the timeout reason, so it is populated only on a timeout",
	},
];

export type LedgerFieldStatus =
	/** Expected always, and populated. */
	| "healthy"
	/** Expected always, and NEVER populated. The actionable class. */
	| "silent"
	/** Expected always, populated on some attempts but not all — worth a look, not an alarm. */
	| "partial"
	/** Empty, and the design says empty is correct. */
	| "correctly_empty"
	/** Sparse, and sparse is what the design predicts. */
	| "sparse_as_expected"
	/** Flag-gated and the flag's state at write time is unknown, so emptiness proves nothing. */
	| "unknown_enablement"
	/** Declared, but added too recently for emptiness to mean anything yet. */
	| "too_new_to_judge"
	/** Investigated: genuinely unpopulated, and closing it needs a capability that does not exist yet. */
	| "blocked_on_capability"
	/** Present in the data but not declared here — nobody has traced its writer and reader. */
	| "undeclared";

export interface LedgerFieldFinding {
	readonly field: string;
	readonly status: LedgerFieldStatus;
	readonly populated: number;
	readonly total: number;
	readonly detail: string;
}

/** An attempt reduced to what this audit needs: which fields carried a value. */
export type AuditableAttempt = Record<string, unknown>;

function isPopulated(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}
	// An empty array is an absence wearing a value's shape — `surfacedSkillIds: []` means "none surfaced", and
	// counting it as populated would report a flag-gated field as healthy on every attempt.
	return !(Array.isArray(value) && value.length === 0);
}

export function auditLedgerFields(input: {
	readonly attempts: readonly AuditableAttempt[];
	/**
	 * Flags known to have been ON. `null` = unknown, which is the honest default: the current process env only
	 * proves what is on NOW, and these events may have been written by another process entirely.
	 */
	readonly enabledFlags?: ReadonlySet<string> | null;
}): { readonly findings: readonly LedgerFieldFinding[]; readonly summary: string } {
	const total = input.attempts.length;
	const findings: LedgerFieldFinding[] = [];

	for (const spec of LEDGER_FIELD_REGISTRY) {
		const populated = input.attempts.filter((attempt) => isPopulated(attempt[spec.field])).length;
		const status = classify(spec, populated, total, input.enabledFlags ?? null);
		findings.push({
			field: spec.field,
			status,
			populated,
			total,
			detail: status === "silent" ? `NEVER populated — ${spec.note}. Read by: ${spec.consumer}` : spec.note,
		});
	}

	// Fields present in the data that nobody has classified. Reported rather than ignored: the registry is only
	// as good as its coverage, and silent coverage gaps are how an audit stops auditing.
	const declared = new Set(LEDGER_FIELD_REGISTRY.map((spec) => spec.field));
	const seen = new Set<string>();
	for (const attempt of input.attempts) {
		for (const key of Object.keys(attempt)) {
			seen.add(key);
		}
	}
	for (const field of [...seen].sort()) {
		if (declared.has(field)) {
			continue;
		}
		const populated = input.attempts.filter((attempt) => isPopulated(attempt[field])).length;
		// Only EMPTY undeclared fields are reported. An undeclared field that carries data is not a risk, and
		// listing every one of them buried the two real findings under 27 rows — the cries-wolf failure this
		// module's own header warns about. An undeclared field carrying NOTHING is an unclassified candidate.
		if (populated > 0) {
			continue;
		}
		findings.push({
			field,
			status: "undeclared",
			populated,
			total,
			detail: "EMPTY and unclassified — nobody has traced this field's writer and reader",
		});
	}

	const silent = findings.filter((finding) => finding.status === "silent");
	return {
		findings,
		summary:
			total === 0
				? "no attempts to audit — this says nothing about any field"
				: `${total} attempt(s); ${silent.length} field(s) SILENT` +
					(silent.length > 0
						? `: ${silent.map((finding) => finding.field).join(", ")} — each has a consumer that can therefore never produce a result`
						: " — every field expected always is carrying data"),
	};
}

function classify(
	spec: LedgerFieldSpec,
	populated: number,
	total: number,
	enabledFlags: ReadonlySet<string> | null,
): LedgerFieldStatus {
	if (spec.expectation === "flag_gated") {
		// Absence proves nothing unless we know the flag was on — the same rule the mechanism registry applies.
		return enabledFlags === null
			? "unknown_enablement"
			: enabledFlags.has(spec.flag ?? "")
				? "healthy"
				: "correctly_empty";
	}
	if (spec.expectation === "needs_capability") {
		// If it ever starts carrying data the capability arrived, and the entry should be re-classified.
		return populated > 0 ? "healthy" : "blocked_on_capability";
	}
	if (spec.expectation === "newly_added") {
		// Once it starts carrying data the entry should be re-classified; until then, silence is uninformative.
		return populated > 0 ? "healthy" : "too_new_to_judge";
	}
	if (spec.expectation === "null_encodes_default") {
		return "correctly_empty";
	}
	if (spec.expectation === "exceptional") {
		return "sparse_as_expected";
	}
	if (spec.expectation === "provider_reported") {
		return populated > 0 ? "healthy" : "correctly_empty";
	}
	if (populated === 0) {
		return "silent";
	}
	return populated === total ? "healthy" : "partial";
}
