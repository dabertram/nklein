import { describe, expect, it } from "vitest";
import {
	completedStepIds,
	MAX_STEP_PLAN_STEPS,
	nextPendingStep,
	renderStepInstruction,
	renderStepPlanForReview,
	type StepPlan,
	stepCapabilityTag,
	stepPlanProgress,
	stepPlanSubmissionSchema,
	validateStepPlan,
} from "../../../src/core/step-plan";

const submission = {
	objective: "Add a --json flag to the CLI",
	assumptions: ["the CLI entry is src/cli.ts"],
	steps: [
		{
			id: "flag",
			title: "Parse the flag",
			intent: "Accept --json on the command line.",
			files: [{ path: "src/cli.ts", symbol: "parseArgs", change: "add a boolean `json` option" }],
			commands: [],
			expectedOutcome: "parseArgs returns { json: true } for --json",
			acceptance: { command: "npm test -- cli", check: "the cli tests pass" },
			inputs: [],
			mustNot: ["change the default output"],
			difficulty: "trivial",
			verify: null,
		},
		{
			id: "print",
			title: "Print JSON",
			intent: "Emit JSON when the flag is set.",
			files: [{ path: "src/cli.ts", symbol: null, change: "branch on options.json and JSON.stringify the report" }],
			commands: ["node src/cli.ts --json"],
			expectedOutcome: "the command prints valid JSON",
			acceptance: {
				command: "node src/cli.ts --json | node -e 'JSON.parse(require(\"fs\").readFileSync(0))'",
				check: "stdout parses as JSON",
			},
			inputs: ["the `json` option from step flag"],
			mustNot: [],
			difficulty: "easy",
			verify: { claim: "JSON.stringify accepts a replacer array", query: "JSON.stringify replacer array MDN" },
		},
	],
};

function plan(overrides: Partial<StepPlan> = {}): StepPlan {
	return {
		...stepPlanSubmissionSchema.parse(submission),
		schemaVersion: 1,
		cardId: "card-1",
		revision: 0,
		baseRef: "abc",
		status: "approved",
		outcomes: [],
		history: [],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("stepPlanSubmissionSchema", () => {
	it("parses a well-formed submission and applies list/optional defaults", () => {
		const parsed = stepPlanSubmissionSchema.parse({
			objective: "x",
			steps: [
				{
					id: "a",
					title: "t",
					intent: "i",
					expectedOutcome: "o",
					acceptance: { check: "c" },
					files: [{ path: "a.ts", change: "edit" }],
				},
			],
		});
		expect(parsed.steps[0]).toMatchObject({
			commands: [],
			inputs: [],
			mustNot: [],
			difficulty: "medium",
			verify: null,
		});
		expect(parsed.steps[0].files[0].symbol).toBeNull();
		expect(parsed.assumptions).toEqual([]);
	});

	it("coerces a bare string into a one-element list (small-model junk-args shape)", () => {
		const parsed = stepPlanSubmissionSchema.parse({
			objective: "x",
			steps: [
				{
					id: "a",
					title: "t",
					intent: "i",
					expectedOutcome: "o",
					acceptance: { check: "c" },
					commands: "npm test",
					mustNot: "touch tests",
				},
			],
		});
		expect(parsed.steps[0].commands).toEqual(["npm test"]);
		expect(parsed.steps[0].mustNot).toEqual(["touch tests"]);
	});
});

describe("validateStepPlan", () => {
	it("accepts the fixture plan", () => {
		expect(validateStepPlan(stepPlanSubmissionSchema.parse(submission))).toEqual({ ok: true, errors: [] });
	});

	it("collects every violation in one pass", () => {
		const bad = stepPlanSubmissionSchema.parse({
			objective: "x",
			steps: [
				{ id: "a", title: "t", intent: "i", expectedOutcome: "o", acceptance: { check: "c" } },
				{
					id: "a",
					title: "t",
					intent: "i",
					expectedOutcome: "o",
					acceptance: { check: "c" },
					files: [{ path: "/Users/david/x.ts", change: "edit" }],
				},
				{
					id: "b",
					title: "t",
					intent: "i",
					expectedOutcome: "o",
					acceptance: { check: "c" },
					commands: ["ls"],
					verify: { claim: "short", query: "q" },
				},
			],
		});
		const result = validateStepPlan(bad);
		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(4);
		expect(result.errors.join("\n")).toMatch(/touches no files and runs no commands/);
		expect(result.errors.join("\n")).toMatch(/duplicate step id "a"/);
		expect(result.errors.join("\n")).toMatch(/non-workspace path "\/Users\/david\/x.ts"/);
		expect(result.errors.join("\n")).toMatch(/claim is too vague/);
	});

	it("rejects an empty plan and a plan longer than the step cap", () => {
		expect(validateStepPlan({ objective: "x", steps: [], assumptions: [] }).errors[0]).toMatch(/at least one step/);
		const long = stepPlanSubmissionSchema.parse({
			objective: "x",
			steps: Array.from({ length: MAX_STEP_PLAN_STEPS + 1 }, (_value, index) => ({
				id: `s${index}`,
				title: "t",
				intent: "i",
				expectedOutcome: "o",
				acceptance: { check: "c" },
				commands: ["ls"],
			})),
		});
		expect(validateStepPlan(long).errors.join("\n")).toMatch(/should be split/);
	});
});

describe("stepCapabilityTag", () => {
	it("maps difficulty + file count onto the F3.41 scale monotonically", () => {
		const trivial = stepCapabilityTag({ difficulty: "trivial", files: [] });
		const hard = stepCapabilityTag({
			difficulty: "hard",
			files: [
				{ path: "a", symbol: null, change: "x" },
				{ path: "b", symbol: null, change: "y" },
			],
		});
		expect(trivial.requiredCapability).toBeLessThan(hard.requiredCapability);
		expect(trivial.smallestTier).toBe("xs");
		expect(hard.smallestTier).not.toBeNull();
	});
});

describe("progress", () => {
	it("walks the steps in order and treats the last outcome per step as authoritative", () => {
		const p = plan({
			outcomes: [
				{ stepId: "flag", status: "failed", note: "boom", citations: [], at: 2 },
				{ stepId: "flag", status: "done", note: "ok", citations: [], at: 3 },
			],
		});
		expect(nextPendingStep(p)?.id).toBe("print");
		expect(completedStepIds(p)).toEqual(["flag"]);
		expect(stepPlanProgress(p)).toEqual({ total: 2, done: 1, failed: 0, nextStepId: "print" });
	});

	it("reports completion when every step is done", () => {
		const p = plan({
			outcomes: [
				{ stepId: "flag", status: "done", note: "", citations: [], at: 2 },
				{ stepId: "print", status: "done", note: "", citations: ["https://x"], at: 3 },
			],
		});
		expect(nextPendingStep(p)).toBeNull();
		expect(stepPlanProgress(p).nextStepId).toBeNull();
	});
});

describe("rendering", () => {
	it("renders the review view with every field and the history", () => {
		const text = renderStepPlanForReview({
			...plan(),
			history: [
				{ revision: 0, trigger: "step_failed", summary: "npm test failed", completedStepIds: ["flag"], at: 1 },
			],
		});
		expect(text).toContain("Planner assumptions (challenge these)");
		expect(text).toContain("### Step 2: print — Print JSON");
		expect(text).toContain("Verify (fact): JSON.stringify accepts a replacer array");
		expect(text).toContain("Must NOT:\n- change the default output");
		expect(text).toContain("revision 0 (step_failed): npm test failed");
		expect(text).toContain("(no command — reviewer: is that acceptable?)".length > 0 ? "Acceptance:" : "");
	});

	it("renders one step as a self-contained instruction with the lookup mandate and the hand-back contract", () => {
		const p = plan({ outcomes: [{ stepId: "flag", status: "done", note: "", citations: [], at: 2 }] });
		const text = renderStepInstruction(p, p.steps[1], {
			lookupAvailable: true,
			attempt: { current: 2, max: 2 },
			retryNote: "exit 1: not JSON",
		});
		expect(text).toContain("step 2 of 2: print — Print JSON");
		expect(text).toContain("1. [done] flag — Parse the flag");
		expect(text).toContain("This is attempt 2 of 2");
		expect(text).toContain("exit 1: not JSON");
		expect(text).toContain("Files to touch (exactly these):\n- src/cli.ts: branch on options.json");
		expect(text).toContain("Commands to run, in order:\n- node src/cli.ts --json");
		expect(text).toContain("Inputs you need");
		expect(text).toContain("!Klein will run `node src/cli.ts --json");
		expect(text).toContain("do not start any other step");
		expect(text).toContain('Call lookup with the query "JSON.stringify replacer array MDN"');
		expect(text).toContain("Never assert an API signature");
		expect(text).toContain("call complete_step with `stepId`");
	});

	it("tells the worker when lookup is absent that the fact stays unverified", () => {
		const p = plan();
		const text = renderStepInstruction(p, p.steps[1], { lookupAvailable: false });
		expect(text).toContain("The lookup tool is not available in this session");
		expect(text).not.toContain("Never assert an API signature");
	});
});
