import { describe, expect, it } from "vitest";
import { type StepPlan, stepPlanSubmissionSchema } from "../../../src/core/step-plan";
import {
	boundAcceptanceOutput,
	decideStepCompletion,
	STEP_PLAN_DELIVER_INSTRUCTION,
} from "../../../src/core/step-plan-execution";
import {
	buildReplanBrief,
	buildReplanHistoryEntry,
	decideReplan,
	REPLAN_EVIDENCE_CHAR_BUDGET,
} from "../../../src/core/step-plan-replan";

function plan(overrides: Partial<StepPlan> = {}): StepPlan {
	return {
		...stepPlanSubmissionSchema.parse({
			objective: "obj",
			steps: [
				{
					id: "a",
					title: "A",
					intent: "do a",
					expectedOutcome: "a done",
					acceptance: { command: "true", check: "a" },
					commands: ["ls"],
				},
				{
					id: "b",
					title: "B",
					intent: "do b",
					expectedOutcome: "b done",
					acceptance: { check: "b" },
					commands: ["ls"],
					verify: { claim: "node 22 fetch supports signal", query: "node fetch signal" },
				},
				{
					id: "c",
					title: "C",
					intent: "do c",
					expectedOutcome: "c done",
					acceptance: { command: "npm test", check: "c" },
					commands: ["ls"],
				},
			],
		}),
		schemaVersion: 1,
		cardId: "card",
		revision: 0,
		baseRef: "base",
		status: "executing",
		outcomes: [],
		history: [],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

const noReceipts = new Set<string>();

describe("decideStepCompletion", () => {
	const base = { attemptsSoFar: 0, maxAttempts: 2, knownReceiptUrls: noReceipts };

	it("advances to the next pending step when acceptance passes", () => {
		const decision = decideStepCompletion({
			...base,
			plan: plan(),
			request: { stepId: "a", note: "done", citations: [], blocked: null },
			acceptance: { exitCode: 0, output: "" },
		});
		expect(decision).toMatchObject({ action: "advance", next: { id: "b" } });
	});

	it("rejects out-of-order, unknown and already-done steps", () => {
		expect(
			decideStepCompletion({
				...base,
				plan: plan(),
				request: { stepId: "b", note: "", citations: [], blocked: null },
				acceptance: null,
			}).action,
		).toBe("reject");
		expect(
			decideStepCompletion({
				...base,
				plan: plan(),
				request: { stepId: "zzz", note: "", citations: [], blocked: null },
				acceptance: null,
			}),
		).toMatchObject({ action: "reject", reason: expect.stringContaining('the current step is "a"') });
		const done = plan({ outcomes: [{ stepId: "a", status: "done", note: "", citations: [], at: 1 }] });
		expect(
			decideStepCompletion({
				...base,
				plan: done,
				request: { stepId: "a", note: "", citations: [], blocked: null },
				acceptance: null,
			}).action,
		).toBe("reject");
	});

	it("retries a failed acceptance once, then replans on the bound", () => {
		const failing = { exitCode: 1, output: "FAIL" };
		const first = decideStepCompletion({
			...base,
			plan: plan(),
			request: { stepId: "a", note: "", citations: [], blocked: null },
			acceptance: failing,
		});
		expect(first).toMatchObject({ action: "retry", attempt: 1, reason: expect.stringContaining("exited 1") });
		const second = decideStepCompletion({
			...base,
			attemptsSoFar: 1,
			plan: plan(),
			request: { stepId: "a", note: "", citations: [], blocked: null },
			acceptance: failing,
		});
		expect(second).toMatchObject({ action: "replan", trigger: "step_failed" });
	});

	it("replans immediately when the worker reports it is blocked", () => {
		const decision = decideStepCompletion({
			...base,
			plan: plan(),
			request: { stepId: "a", note: "", citations: [], blocked: "the file does not exist" },
			acceptance: null,
		});
		expect(decision).toMatchObject({
			action: "replan",
			trigger: "worker_blocked",
			reason: "the file does not exist",
		});
	});

	it("refuses a verify step without a receipt-backed citation and accepts one with it", () => {
		const done = plan({ outcomes: [{ stepId: "a", status: "done", note: "", citations: [], at: 1 }] });
		const request = {
			stepId: "b",
			note: "verified",
			citations: ["https://nodejs.org/api/globals.html"],
			blocked: null,
		};
		expect(decideStepCompletion({ ...base, plan: done, request, acceptance: null }).action).toBe("retry");
		const accepted = decideStepCompletion({
			...base,
			plan: done,
			request,
			acceptance: null,
			knownReceiptUrls: new Set(["https://nodejs.org/api/globals.html"]),
		});
		expect(accepted).toMatchObject({ action: "advance", next: { id: "c" } });
	});

	it("delivers after the last step", () => {
		const nearlyDone = plan({
			outcomes: [
				{ stepId: "a", status: "done", note: "", citations: [], at: 1 },
				{ stepId: "b", status: "done", note: "", citations: ["x"], at: 2 },
			],
		});
		expect(
			decideStepCompletion({
				...base,
				plan: nearlyDone,
				request: { stepId: "c", note: "", citations: [], blocked: null },
				acceptance: { exitCode: 0, output: "ok" },
			}).action,
		).toBe("deliver");
		expect(STEP_PLAN_DELIVER_INSTRUCTION).toContain("Do not start new work");
	});

	it("bounds acceptance output head+tail", () => {
		const bounded = boundAcceptanceOutput(`${"a".repeat(1000)}MIDDLE${"b".repeat(1000)}`, 200);
		expect(bounded).not.toContain("MIDDLE");
		expect(bounded).toMatch(/^a{100}\n\[… \d+ chars elided …\]\nb{100}$/);
	});
});

describe("replanning", () => {
	it("bounds replans", () => {
		expect(decideReplan({ trigger: "step_failed", replanCount: 0, maxReplans: 2 }).action).toBe("replan");
		expect(decideReplan({ trigger: "user_steer", replanCount: 2, maxReplans: 2 }).action).toBe("exhausted");
	});

	it("records history with the done steps and bounded evidence", () => {
		const p = plan({ outcomes: [{ stepId: "a", status: "done", note: "", citations: [], at: 1 }] });
		const entry = buildReplanHistoryEntry(p, {
			trigger: "step_failed",
			stepId: "b",
			detail: "x".repeat(REPLAN_EVIDENCE_CHAR_BUDGET + 50),
			at: 9,
		});
		expect(entry).toMatchObject({ revision: 0, trigger: "step_failed", completedStepIds: ["a"], at: 9 });
		expect(entry.summary).toContain("a step failed its acceptance repeatedly (step b — B).");
		expect(entry.summary).toContain("[truncated 50 chars]");
	});

	it("builds a brief that names the done steps, the pending steps, the evidence and the lessons", () => {
		const p = plan({
			outcomes: [{ stepId: "a", status: "done", note: "", citations: [], at: 1 }],
			history: [
				{ revision: 0, trigger: "review_bounce", summary: "reviewer: missing tests", completedStepIds: [], at: 1 },
			],
			revision: 1,
		});
		const brief = buildReplanBrief(p, { trigger: "base_changed", detail: "base moved abc -> def", at: 2 });
		expect(brief).toContain("REPLAN request, revision 2");
		expect(brief).toContain("Reason: the card's base commit changed under the plan.");
		expect(brief).toContain("base moved abc -> def");
		expect(brief).toContain("Steps already DONE and accepted");
		expect(brief).toContain("- a — A");
		expect(brief).toContain("- b — B: do b");
		expect(brief).toContain("revision 0 (review_bounce): reviewer: missing tests");
		expect(brief).toContain("submit_step_plan");
	});
});
