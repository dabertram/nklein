import { describe, expect, it } from "vitest";
import {
	type AdwStep,
	adwWorkflowSchema,
	evaluateAgentVerify,
	evaluateDeterministicVerify,
	isSafeAdwName,
	renderAdwText,
	runAdwWorkflow,
} from "../../../src/core/adw-workflow";

const DET = { id: "build", kind: "deterministic", command: "npm run build" } as const;
const AGENT = {
	id: "fix",
	kind: "agent",
	card: { title: "Fix {input}", prompt: "Fix the bug: {input}. Evidence:\n{steps.build.outputTail}" },
} as const;

describe("adw-workflow schema", () => {
	it("parses a minimal workflow and applies defaults", () => {
		const workflow = adwWorkflowSchema.parse({ steps: [DET, AGENT] });
		const det = workflow.steps[0];
		const agent = workflow.steps[1];
		if (!det || det.kind !== "deterministic" || !agent || agent.kind !== "agent") {
			throw new Error("fixture");
		}
		expect(det.verify.mustExitZero).toBe(true);
		expect(agent.awaitTimeoutMs).toBe(45 * 60_000);
	});

	it("refuses duplicate step ids and empty workflows", () => {
		expect(() => adwWorkflowSchema.parse({ steps: [] })).toThrow();
		expect(() => adwWorkflowSchema.parse({ steps: [DET, { ...DET }] })).toThrow(/Duplicate step id/);
	});

	it("gates workflow names", () => {
		expect(isSafeAdwName("bug-report")).toBe(true);
		expect(isSafeAdwName("../evil")).toBe(false);
	});
});

describe("renderAdwText", () => {
	it("substitutes tokens and keeps unknown tokens visible", () => {
		const rendered = renderAdwText("wf={workflow} in={input} tail={steps.build.outputTail} nope={mystery}", {
			workflowName: "bug-report",
			input: "crash on save",
			now: 1_784_400_000_000,
			outputTailByStepId: new Map([["build", "BUILD OK"]]),
		});
		expect(rendered).toBe("wf=bug-report in=crash on save tail=BUILD OK nope={mystery}");
	});
});

describe("verify evaluation", () => {
	it("deterministic: exit code, timeout, and outputContains gates", () => {
		const step = adwWorkflowSchema.parse({
			steps: [{ ...DET, verify: { mustExitZero: true, outputContains: "PASS" } }],
		}).steps[0];
		if (!step || step.kind !== "deterministic") {
			throw new Error("fixture");
		}
		expect(evaluateDeterministicVerify(step, { exitCode: 0, output: "all PASS", timedOut: false }).ok).toBe(true);
		expect(evaluateDeterministicVerify(step, { exitCode: 1, output: "PASS", timedOut: false }).ok).toBe(false);
		expect(evaluateDeterministicVerify(step, { exitCode: 0, output: "nope", timedOut: false }).ok).toBe(false);
		expect(evaluateDeterministicVerify(step, { exitCode: null, output: "", timedOut: true }).ok).toBe(false);
	});

	it("agent: completed passes, trash/timeout fail, mustComplete:false accepts any settled lane", () => {
		const strict = adwWorkflowSchema.parse({ steps: [AGENT] }).steps[0];
		if (!strict || strict.kind !== "agent") {
			throw new Error("fixture");
		}
		expect(evaluateAgentVerify(strict, { lane: "completed", timedOut: false }).ok).toBe(true);
		expect(evaluateAgentVerify(strict, { lane: "trash", timedOut: false }).ok).toBe(false);
		expect(evaluateAgentVerify(strict, { lane: null, timedOut: true }).ok).toBe(false);
		const lax = { ...strict, verify: { mustComplete: false } };
		expect(evaluateAgentVerify(lax, { lane: "trash", timedOut: false }).ok).toBe(true);
	});
});

describe("runAdwWorkflow orchestrator", () => {
	const workflow = adwWorkflowSchema.parse({ steps: [DET, AGENT] });

	it("threads deterministic output tails into later agent card prompts and passes end-to-end", async () => {
		const seededPrompts: string[] = [];
		const evidence = new Map<string, string>();
		const report = await runAdwWorkflow(
			workflow,
			{ workflowName: "bug-report", input: "crash on save" },
			{
				now: () => 1,
				runCommand: async () => ({ exitCode: 0, output: "BUILD EVIDENCE LINE", timedOut: false }),
				runAgentCard: async (_step, card) => {
					seededPrompts.push(card.prompt);
					return { cardId: "card-1", lane: "completed", timedOut: false };
				},
				writeEvidence: async (stepId, content) => {
					evidence.set(stepId, content);
				},
			},
		);
		expect(report.verdict).toBe("pass");
		expect(report.failedStepId).toBeNull();
		expect(seededPrompts[0]).toContain("crash on save");
		expect(seededPrompts[0]).toContain("BUILD EVIDENCE LINE");
		expect(evidence.get("build")).toBe("BUILD EVIDENCE LINE");
	});

	it("halts on the first failed verify and reports the remainder as skipped", async () => {
		let agentRan = false;
		const report = await runAdwWorkflow(
			workflow,
			{ workflowName: "bug-report", input: "x" },
			{
				now: () => 1,
				runCommand: async () => ({ exitCode: 2, output: "boom", timedOut: false }),
				runAgentCard: async () => {
					agentRan = true;
					return { cardId: "card-1", lane: "completed", timedOut: false };
				},
				writeEvidence: async () => {},
			},
		);
		expect(report.verdict).toBe("fail");
		expect(report.failedStepId).toBe("build");
		expect(agentRan).toBe(false);
		const steps: Array<{ id: string; skipped?: boolean }> = report.steps;
		expect(steps[1]?.skipped).toBe(true);
	});

	it("fails the run when an agent card ends outside Completed", async () => {
		const agentOnly = adwWorkflowSchema.parse({ steps: [AGENT] });
		const report = await runAdwWorkflow(
			agentOnly,
			{ workflowName: "w", input: "" },
			{
				now: () => 1,
				runCommand: async () => ({ exitCode: 0, output: "", timedOut: false }),
				runAgentCard: async () => ({ cardId: "card-9", lane: "trash", timedOut: false }),
				writeEvidence: async () => {},
			},
		);
		expect(report.verdict).toBe("fail");
		expect(report.steps[0]?.cardId).toBe("card-9");
	});
});

// Type-level sanity: AdwStep narrows by kind.
const _narrow = (step: AdwStep): string => (step.kind === "deterministic" ? step.command : step.card.prompt);
void _narrow;
