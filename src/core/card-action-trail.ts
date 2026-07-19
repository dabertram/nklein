/**
 * F12.55 plain-language, artifact-anchored action trail — PURE core.
 *
 * Operators can't audit a raw tool-call dump; they need "what actually happened, anchored to real artifacts". This
 * projection walks a card's ledger events (attempts + their tool calls, retrievals, controller transitions) and emits
 * a chronological trail of MEANINGFUL plain-language entries:
 *   - each entry is anchored to the FACTS the ledger recorded (file paths, outcomes, queries, citations) — never to
 *     the agent's narrative;
 *   - each action carries a reversibility class (read-only / reversible-in-worktree / irreversible) so the eye finds
 *     the dangerous lines first;
 *   - the agent's own plan step (`focusStep`) is framed as a HYPOTHESIS about intent, never as evidence — CoT is
 *     often post-hoc (2601.16720).
 * Pure + deterministic over the persisted ledger; the caller reads the store.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";

export type TrailReversibility = "read_only" | "reversible" | "irreversible";

export interface CardTrailEntry {
	/** Best-known timestamp (attempt completion for actions; event recordedAt otherwise). */
	readonly at: number | null;
	readonly kind: "action" | "retrieval" | "transition" | "attempt_end";
	/** The plain-language line ("Edited src/auth.ts", "Searched code for `refresh token` — 3 citations kept"). */
	readonly text: string;
	/** Artifact anchor: the file paths this entry touched (empty when none recorded). */
	readonly files: readonly string[];
	readonly reversibility: TrailReversibility;
	/**
	 * The agent's own stated intent at the time (its focus-chain step), framed as a hypothesis — rendered as
	 * "working hypothesis", never as ground truth about why the change is correct.
	 */
	readonly hypothesis: string | null;
}

const IRREVERSIBLE_NAME = /push|publish|deploy|open_pr|send|mail|delete|remove|drop|merge|release|unload/i;
const READ_ONLY_NAME = /^(read|search|list|get|repo_map|inspect|preview|show|stat|fetch|web_research|predict_output)/i;

/**
 * Classify a tool call's reversibility from its name. Everything unknown defaults to `reversible` (worktree writes
 * are git-revertable) EXCEPT names matching outward/destructive verbs — those read `irreversible` even when unknown,
 * because under-warning on an irreversible action is the expensive mistake.
 */
export function classifyToolReversibility(name: string): TrailReversibility {
	if (IRREVERSIBLE_NAME.test(name)) {
		return "irreversible";
	}
	if (READ_ONLY_NAME.test(name)) {
		return "read_only";
	}
	return "reversible";
}

const ACTION_VERBS: readonly { pattern: RegExp; verb: (files: string) => string }[] = [
	{ pattern: /^write_files?$|^apply_patch$|^edit/i, verb: (files) => `Edited ${files || "files"}` },
	{ pattern: /^read_files?$/i, verb: (files) => `Read ${files || "files"}` },
	{ pattern: /^run_commands?$/i, verb: () => "Ran a command in the sandbox" },
	{ pattern: /^search_code$/i, verb: () => "Searched the code" },
	{ pattern: /^repo_map$/i, verb: () => "Mapped the repository" },
	{ pattern: /^submit_review$/i, verb: () => "Submitted a review verdict" },
	{ pattern: /^predict_output$/i, verb: () => "Predicted the acceptance output (checked against the real run)" },
	{ pattern: /^decompose_project$/i, verb: () => "Decomposed the project into cards" },
	{ pattern: /^web_research$/i, verb: () => "Fetched an allow-listed web source" },
];

function describeToolCall(name: string, files: readonly string[]): string {
	const fileText =
		files.length === 0
			? ""
			: files.length <= 2
				? files.join(", ")
				: `${files.slice(0, 2).join(", ")} +${files.length - 2} more`;
	const known = ACTION_VERBS.find((entry) => entry.pattern.test(name));
	const base = known ? known.verb(fileText) : `Used ${name}${fileText ? ` on ${fileText}` : ""}`;
	return base;
}

const OUTCOME_TEXT: Record<string, string> = {
	success: "finished cleanly",
	no_tool_call: "produced no tool call",
	narrated: "narrated instead of acting (salvaged)",
	loop: "looped and was stopped",
	timeout: "timed out",
	malformed: "produced malformed output",
	aborted: "was aborted",
	other_failure: "failed",
};

/**
 * Build the chronological trail for one card. Meaningful = every tool call that touched files or is
 * outward/irreversible, plus retrievals with their kept citations, plus attempt terminals; pure read-only churn
 * (read/list/search bursts with no files recorded) is collapsed into a single "explored" line per attempt so the
 * trail stays a story, not a dump.
 */
export function buildCardActionTrail(events: readonly AgentLedgerEvent[], taskId: string): CardTrailEntry[] {
	const trail: CardTrailEntry[] = [];
	for (const event of events) {
		if (event.taskId !== taskId) {
			continue;
		}
		if (event.kind === "retrieval") {
			trail.push({
				at: event.recordedAt,
				kind: "retrieval",
				text: `Searched for \`${event.query}\` — ${event.hitsConsidered} hit(s) considered, ${event.citations.length} citation(s) kept${event.distractorsPruned > 0 ? `, ${event.distractorsPruned} distractor(s) pruned` : ""}`,
				files: event.citations,
				reversibility: "read_only",
				hypothesis: null,
			});
			continue;
		}
		if (event.kind === "transition") {
			// Focus steps become hypotheses on later actions; controller decisions are trail-worthy on their own.
			if (event.controllerDecision) {
				trail.push({
					at: event.recordedAt,
					kind: "transition",
					text: `Controller: ${event.from ?? "?"} → ${event.to}${event.reason ? ` (${event.reason})` : ""}`,
					files: [],
					reversibility: "read_only",
					hypothesis: null,
				});
			}
			continue;
		}
		if (event.kind !== "attempt") {
			continue;
		}
		const hypothesis = event.focusStep
			? `Working hypothesis (the agent's own plan step, not evidence): ${event.focusStep}`
			: null;
		let quietReads = 0;
		for (const toolCall of event.toolCalls) {
			const files = toolCall.filePaths ?? [];
			const reversibility = classifyToolReversibility(toolCall.name);
			if (reversibility === "read_only" && files.length === 0) {
				quietReads += 1;
				continue;
			}
			const failed = toolCall.outcome !== null && !/^(ok|success)/i.test(toolCall.outcome);
			trail.push({
				at: event.completedAt ?? event.recordedAt,
				kind: "action",
				text: `${describeToolCall(toolCall.name, files)}${failed ? ` — FAILED (${toolCall.outcome})` : ""}${
					toolCall.resultSummary ? ` → ${toolCall.resultSummary}` : ""
				}`,
				files,
				reversibility,
				hypothesis,
			});
		}
		if (quietReads > 0) {
			trail.push({
				at: event.completedAt ?? event.recordedAt,
				kind: "action",
				text: `Explored the workspace (${quietReads} read/search call(s))`,
				files: [],
				reversibility: "read_only",
				hypothesis,
			});
		}
		trail.push({
			at: event.completedAt ?? event.recordedAt,
			kind: "attempt_end",
			text: `Attempt on ${event.modelId} ${OUTCOME_TEXT[event.outcome] ?? event.outcome}${
				event.qualityScore !== null ? ` (quality ${event.qualityScore})` : ""
			}${event.salvage ? ` — salvage: ${event.salvage}` : ""}`,
			files: event.artifacts?.patchRef ? [event.artifacts.patchRef] : [],
			reversibility: "read_only",
			hypothesis,
		});
	}
	trail.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
	return trail;
}
