import { describe, expect, it } from "vitest";
import { describeEscalationResumeAction, isResumableEscalation } from "../../../src/core/escalation-resume-action";
import type { EscalationSuggestionKind } from "../../../src/core/escalation-suggestions";

/**
 * F2.18 — the escalation → resume-action mapping: every actionable suggestion re-enters the EXACT suspended
 * state (redrive from the parked result branch), only re-scope is manual, and input-first kinds name what the
 * operator must supply before the resume.
 */

const ALL_KINDS: EscalationSuggestionKind[] = [
	"clarify_ambiguity",
	"provide_context",
	"adjust_constraints",
	"approve_blocked_action",
	"fix_environment",
	"rescope_or_split",
	"provide_more_capable_model",
];

describe("describeEscalationResumeAction", () => {
	it("every kind has an entry and only re-scope is manual (no in-app resume)", () => {
		for (const kind of ALL_KINDS) {
			const action = describeEscalationResumeAction(kind);
			expect(action.kind).toBe(kind);
			if (kind === "rescope_or_split") {
				expect(action.mode).toBe("manual");
				expect(action.actionLabel).toBeNull();
				expect(action.resumesSuspendedState).toBe(false);
				expect(isResumableEscalation(kind)).toBe(false);
			} else {
				expect(action.mode).not.toBe("manual");
				expect(action.actionLabel).toBeTruthy();
				expect(action.resumesSuspendedState).toBe(true); // resumes the parked branch, never a cold restart
				expect(isResumableEscalation(kind)).toBe(true);
			}
		}
	});

	it("approval-only unblocks redrive directly; input-first kinds name the required input", () => {
		expect(describeEscalationResumeAction("approve_blocked_action")).toMatchObject({
			mode: "direct_redrive",
			requiresInput: null,
		});
		expect(describeEscalationResumeAction("provide_more_capable_model").mode).toBe("direct_redrive");
		expect(describeEscalationResumeAction("clarify_ambiguity")).toMatchObject({
			mode: "input_then_redrive",
			requiresInput: "answer",
		});
		expect(describeEscalationResumeAction("provide_context").requiresInput).toBe("context");
		expect(describeEscalationResumeAction("adjust_constraints").requiresInput).toBe("constraint");
	});
});
