/**
 * P15.7b — the tracked-requirement map: which backlog items get element-level coverage checking.
 *
 * P15.7 built the judging. This is the curation, and **the curation is where this tool gets quietly neutered.**
 * There are two ways to make it useless while it still reports green:
 *  1. Declare a requirement with elements it does not really have — it passes and proves nothing.
 *  2. Omit the requirements most likely to be half-wired — nothing fails because nothing was asked.
 * **Both are indistinguishable from a healthy run.** No amount of care in `requirement-coverage-audit.ts` can
 * detect either, because both are lies of omission in its INPUT.
 *
 * So this map is seeded deliberately with requirements ALREADY PROVEN to be split — F4.8 and F3.8, both traced on
 * 2026-07-20 with named elements and named unwired providers. **They must come out RED.** A first run that passes
 * cleanly is evidence this map is wrong, not that the codebase is well-wired, and the accompanying test asserts
 * the failure rather than the pass for exactly that reason.
 *
 * Element→provider attributions are hand-written and can be wrong or stale. What is NOT hand-written is whether a
 * provider is wired: that comes from the same source scan `dev unwired-cores` uses. The judgement most likely to
 * rot is the one taken out of human hands on purpose.
 */

import type { RequirementSpec } from "./requirement-coverage-audit";

export const TRACKED_REQUIREMENTS: readonly RequirementSpec[] = [
	{
		// F4.8 — "retain objective, current focus, constraints, and acceptance criteria".
		// Traced 2026-07-20: context-reanchor is wired through task-reanchor-before-model →
		// nklein-context-focus-extension → nklein-session-runtime. instruction-reanchor (F12.21) has no importers.
		id: "F4.8",
		elements: [
			{ element: "objective", providedBy: { module: "context-reanchor.ts", symbol: "buildContextReanchor" } },
			{ element: "current_focus", providedBy: { module: "context-reanchor.ts", symbol: "buildContextReanchor" } },
			// Carried by NEITHER re-anchor core. Recorded as unmapped rather than guessed at.
			{ element: "constraints", providedBy: null },
			{
				element: "acceptance_criteria",
				providedBy: { module: "instruction-reanchor.ts", symbol: "buildReanchorReminder" },
			},
		],
	},
	{
		// F3.8 — adopt the retry-policy engine on chat. Traced 2026-07-20: planNextAttempt's only caller is
		// adaptive-attempt-loop.ts, which itself has zero importers, so rung SELECTION reaches no live path.
		id: "F3.8",
		elements: [
			{
				element: "budget_exhaustion_park",
				providedBy: { module: "retry-policy.ts", symbol: "decideNextRetryStrategy" },
			},
			{
				element: "rung_selection",
				providedBy: { module: "adaptive-attempt-loop.ts", symbol: "runAdaptiveAttemptLoop" },
			},
			{ element: "ladder_planning", providedBy: { module: "retry-policy.ts", symbol: "planNextAttempt" } },
		],
	},
];
