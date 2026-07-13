import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	nkleinPlanTaskGraphSchema,
	readNKleinPlanArtifacts,
	resolveNKleinPlanArtifactPaths,
	writeNKleinPlanArtifacts,
} from "../../../src/nklein-agent/nklein-plan-artifacts";
import {
	clarifyTextSimilarity,
	resolvePlanQuestion,
	runDecompositionClarificationPass,
	runModelBackedClarifyLoop,
} from "../../../src/nklein-agent/nklein-plan-clarification";

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

async function createPlanWorkspace(): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-clarify-"));
	await writeNKleinPlanArtifacts({
		workspacePath,
		slug: "clarify",
		spec: "spec",
		plan: "plan",
		questions: [
			{
				id: "q-storage",
				question: "Which storage backend?",
				status: "open",
				options: [
					{ id: "sqlite", label: "SQLite", description: null, recommended: true },
					{ id: "json", label: "Flat JSON", description: null, recommended: false },
				],
				answer: null,
				assumption: "Assume SQLite.",
				blockedTaskId: null,
			},
			{
				id: "q-auth",
				question: "Is auth in scope?",
				status: "open",
				options: [],
				answer: null,
				assumption: null,
				blockedTaskId: null,
			},
		],
		taskGraph: nkleinPlanTaskGraphSchema.parse({
			schemaVersion: 1,
			slug: "clarify",
			title: "Clarify",
			tasks: [{ id: "t1", title: "Task 1", prompt: "Do task 1" }],
		}),
	});
	return workspacePath;
}

describe("resolvePlanQuestion (F1.3b answer→revision connector)", () => {
	it("persists an operator answer onto the stored question and appends a clarification_resolved revision", async () => {
		const workspacePath = await createPlanWorkspace();
		const result = await resolvePlanQuestion({
			workspacePath,
			slug: "clarify",
			questionId: "q-storage",
			resolution: { source: "operator", answer: { selectedOptionIds: ["sqlite"], freeText: "WAL mode please" } },
		});
		expect(result).toMatchObject({ ok: true, changed: true });

		const artifacts = await readNKleinPlanArtifacts(workspacePath, "clarify");
		expect(artifacts.questions[0]).toMatchObject({
			id: "q-storage",
			status: "answered",
			answer: "SQLite; WAL mode please",
			assumption: null, // an explicit answer overrides the assumed default
		});
		expect(artifacts.questions[1]).toMatchObject({ id: "q-auth", status: "open" }); // sibling untouched
		const revisions = await readFile(resolveNKleinPlanArtifactPaths(workspacePath, "clarify").revisionsPath, "utf8");
		expect(revisions).toContain("clarification_resolved");
		expect(revisions).toContain('Question "q-storage" answered by the operator: SQLite; WAL mode please');
	});

	it("persists an auto give-up-with-assumption decision as assumed-default", async () => {
		const workspacePath = await createPlanWorkspace();
		const result = await resolvePlanQuestion({
			workspacePath,
			slug: "clarify",
			questionId: "q-auth",
			resolution: {
				source: "auto",
				decision: {
					action: "give_up_with_assumption",
					assumption: "No auth — single-user local app.",
					reason: "Round budget exhausted.",
				},
			},
		});
		expect(result).toMatchObject({ ok: true, changed: true });
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "clarify");
		expect(artifacts.questions[1]).toMatchObject({
			id: "q-auth",
			status: "assumed-default",
			assumption: "No auth — single-user local app.",
			blockedTaskId: null,
		});
		const revisions = await readFile(resolveNKleinPlanArtifactPaths(workspacePath, "clarify").revisionsPath, "utf8");
		expect(revisions).toContain("resolved by the automatic clarification pass with an assumed default");
	});

	it("keep_asking and empty operator submissions change nothing and append no revision", async () => {
		const workspacePath = await createPlanWorkspace();
		const keepAsking = await resolvePlanQuestion({
			workspacePath,
			slug: "clarify",
			questionId: "q-auth",
			resolution: { source: "auto", decision: { action: "keep_asking", reason: "Needs the operator." } },
		});
		expect(keepAsking).toMatchObject({ ok: true, changed: false });
		const emptyAnswer = await resolvePlanQuestion({
			workspacePath,
			slug: "clarify",
			questionId: "q-auth",
			resolution: { source: "operator", answer: { selectedOptionIds: [], freeText: "   " } },
		});
		expect(emptyAnswer).toMatchObject({ ok: true, changed: false });
		const revisions = await readFile(resolveNKleinPlanArtifactPaths(workspacePath, "clarify").revisionsPath, "utf8");
		expect(revisions).not.toContain("clarification_resolved");
	});

	it("fails loudly for an unknown question or plan", async () => {
		const workspacePath = await createPlanWorkspace();
		const missingQuestion = await resolvePlanQuestion({
			workspacePath,
			slug: "clarify",
			questionId: "q-nope",
			resolution: { source: "auto", decision: { action: "answer", answer: "x", reason: "confident" } },
		});
		expect(missingQuestion).toMatchObject({ ok: false });
		const missingPlan = await resolvePlanQuestion({
			workspacePath,
			slug: "no-such-plan",
			questionId: "q-auth",
			resolution: { source: "auto", decision: { action: "answer", answer: "x", reason: "confident" } },
		});
		expect(missingPlan).toMatchObject({ ok: false });
	});
});

describe("runDecompositionClarificationPass (F1.3c)", () => {
	it("auto-resolves safe defaults, keeps risky/default-less questions open, and records revisions", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-clarify-pass-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "pass",
			spec: "spec",
			plan: "plan",
			questions: [
				{
					id: "q-safe",
					question: "Which storage backend should the habit log use for local persistence?",
					status: "open",
					options: [{ id: "sqlite", label: "SQLite", description: null, recommended: true }],
					answer: null,
					assumption: "Assume SQLite (recommended).",
					blockedTaskId: null,
				},
				{
					id: "q-risky",
					question: "Not sure — should we maybe delete the legacy schema, or keep it? Either could work.",
					status: "open",
					options: [],
					answer: null,
					assumption: "Assume we delete it.",
					blockedTaskId: null,
				},
				{
					id: "q-no-default",
					question: "Which of the four proposed navigation structures should the app use?",
					status: "open",
					options: [],
					answer: null,
					assumption: null,
					blockedTaskId: null,
				},
				{
					id: "q-done",
					question: "Is auth in scope?",
					status: "answered",
					options: [],
					answer: "No.",
					assumption: null,
					blockedTaskId: null,
				},
			],
			taskGraph: nkleinPlanTaskGraphSchema.parse({
				schemaVersion: 1,
				slug: "pass",
				title: "Pass",
				tasks: [{ id: "t1", title: "Task 1", prompt: "Do task 1" }],
			}),
		});

		const summary = await runDecompositionClarificationPass({ workspacePath, slug: "pass", mode: "cautious" });
		expect(summary).toMatchObject({
			openQuestionCount: 3,
			assumedCount: 1,
			keptOpenCount: 2,
			openQuestionIds: ["q-risky", "q-no-default"],
		});

		const artifacts = await readNKleinPlanArtifacts(workspacePath, "pass");
		expect(artifacts.questions.find((question) => question.id === "q-safe")).toMatchObject({
			status: "assumed-default",
			assumption: "Assume SQLite (recommended).",
			blockedTaskId: null,
		});
		expect(artifacts.questions.find((question) => question.id === "q-risky")?.status).toBe("open");
		expect(artifacts.questions.find((question) => question.id === "q-no-default")?.status).toBe("open");
		expect(artifacts.questions.find((question) => question.id === "q-done")?.status).toBe("answered");
		const revisions = await readFile(resolveNKleinPlanArtifactPaths(workspacePath, "pass").revisionsPath, "utf8");
		expect(revisions).toContain("clarification_resolved");
		expect(revisions).toContain('"q-safe"');
		expect(revisions).not.toContain('"q-risky"');
	});
});

describe("resolvePlanQuestion block linkage (F1.3d)", () => {
	it("returns the parked task id and releases the block on resolution", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-plan-clarify-block-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "blocked",
			spec: "spec",
			plan: "plan",
			questions: [
				{
					id: "q-blocked",
					question: "Which port should the dev server bind?",
					status: "open",
					options: [],
					answer: null,
					assumption: null,
					blockedTaskId: "task-77",
				},
			],
			taskGraph: nkleinPlanTaskGraphSchema.parse({
				schemaVersion: 1,
				slug: "blocked",
				title: "Blocked",
				tasks: [{ id: "t1", title: "Task 1", prompt: "Do task 1" }],
			}),
		});
		const resolved = await resolvePlanQuestion({
			workspacePath,
			slug: "blocked",
			questionId: "q-blocked",
			resolution: { source: "operator", answer: { freeText: "Port 4173." } },
		});
		expect(resolved).toMatchObject({ ok: true, changed: true, blockedTaskId: "task-77" });
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "blocked");
		expect(artifacts.questions[0]).toMatchObject({
			id: "q-blocked",
			status: "answered",
			answer: "Port 4173.",
			blockedTaskId: null, // released
		});
	});
});

describe("runModelBackedClarifyLoop (F1.3e)", () => {
	async function createLoopWorkspace(): Promise<string> {
		const workspacePath = await mkdtemp(join(tmpdir(), "kanban-clarify-loop-"));
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "loop",
			spec: "spec",
			plan: "plan",
			questions: [
				{
					id: "q-a",
					question: "Which of the four proposed navigation structures should the app use?",
					status: "open",
					options: [],
					answer: null,
					assumption: null,
					blockedTaskId: null,
				},
				{
					id: "q-b",
					question: "Which chart library should the dashboard use?",
					status: "open",
					options: [],
					answer: null,
					assumption: null,
					blockedTaskId: null,
				},
			],
			taskGraph: nkleinPlanTaskGraphSchema.parse({
				schemaVersion: 1,
				slug: "loop",
				title: "Loop",
				tasks: [{ id: "t1", title: "Task 1", prompt: "Do task 1" }],
			}),
		});
		return workspacePath;
	}

	it("persists a confident architect answer (reviewer unconsulted on a resolved proposal)", async () => {
		const workspacePath = await createLoopWorkspace();
		const turns: string[] = [];
		const summary = await runModelBackedClarifyLoop({
			workspacePath,
			slug: "loop",
			questionIds: ["q-a"],
			requestClarifyTurn: async ({ role }) => {
				turns.push(role);
				return { verdict: "proceed", summary: "Use a tab bar with four tabs.", feedback: null };
			},
		});
		expect(summary).toEqual({ resolvedCount: 1, keptOpenIds: [] });
		expect(turns).toEqual(["propose"]); // confident proposal skips the reviewer
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "loop");
		expect(artifacts.questions[0]).toMatchObject({
			id: "q-a",
			status: "answered",
			answer: "Use a tab bar with four tabs.",
		});
	});

	it("keeps a question open when no turn is available, and respects the per-decomposition question cap", async () => {
		const workspacePath = await createLoopWorkspace();
		const summary = await runModelBackedClarifyLoop({
			workspacePath,
			slug: "loop",
			questionIds: ["q-a", "q-b"],
			maxQuestions: 1,
			requestClarifyTurn: async () => null, // budget spent / no model
		});
		expect(summary.resolvedCount).toBe(0);
		expect(summary.keptOpenIds).toEqual(["q-a", "q-b"]);
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "loop");
		expect(artifacts.questions.every((question) => question.status === "open")).toBe(true);
	});

	it("adopts the give-up assumption when the reviewer keeps objecting through the tight round budget", async () => {
		const workspacePath = await createLoopWorkspace();
		let proposeCount = 0;
		const summary = await runModelBackedClarifyLoop({
			workspacePath,
			slug: "loop",
			questionIds: ["q-b"],
			requestClarifyTurn: async ({ role }) => {
				if (role === "propose") {
					proposeCount += 1;
					return {
						verdict: "revise",
						summary: `Unsure round ${proposeCount}`,
						feedback: `Leaning toward ECharts (round ${proposeCount}).`,
					};
				}
				return { verdict: "revise", summary: "Objection", feedback: "Consider the bundle size." };
			},
		});
		// The 2-round budget expires ⇒ give_up_with_assumption on the latest proposal — planning never blocks.
		expect(summary).toEqual({ resolvedCount: 1, keptOpenIds: [] });
		const artifacts = await readNKleinPlanArtifacts(workspacePath, "loop");
		expect(artifacts.questions[1]).toMatchObject({ id: "q-b", status: "assumed-default" });
	});
});

describe("clarifyTextSimilarity", () => {
	it("is 1 for identical token sets, 0 for disjoint, and symmetric in between", () => {
		expect(clarifyTextSimilarity("use sqlite storage", "use sqlite storage")).toBe(1);
		expect(clarifyTextSimilarity("alpha beta", "gamma delta")).toBe(0);
		const ab = clarifyTextSimilarity("alpha beta gamma", "beta gamma delta");
		expect(ab).toBeCloseTo(0.5, 5);
		expect(ab).toBe(clarifyTextSimilarity("beta gamma delta", "alpha beta gamma"));
	});
});
