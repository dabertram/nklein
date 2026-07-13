import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { nkleinPlanTaskGraphSchema, writeNKleinPlanArtifacts } from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskSessionService } from "../../../src/nklein-agent/nklein-task-session-service";
import { handleAnswerPlanQuestion, handleListPlanQuestions } from "../../../src/trpc/runtime-api/answer-plan-question";

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

async function createPlanWorkspace(blockedTaskId: string | null): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-answer-question-"));
	await writeNKleinPlanArtifacts({
		workspacePath,
		slug: "plan",
		spec: "spec",
		plan: "plan",
		questions: [
			{
				id: "q-1",
				question: "Which port should the dev server bind?",
				status: "open",
				options: [{ id: "default", label: "4173", description: null, recommended: true }],
				answer: null,
				assumption: null,
				blockedTaskId,
			},
		],
		taskGraph: nkleinPlanTaskGraphSchema.parse({
			schemaVersion: 1,
			slug: "plan",
			title: "Plan",
			tasks: [{ id: "t1", title: "Task 1", prompt: "Do task 1" }],
		}),
	});
	return workspacePath;
}

function fakeService(state: string, reviewReason: string | null) {
	const sendTaskSessionInput = vi.fn(async () => ({ taskId: "task-9" }) as never);
	const service = {
		getSummary: vi.fn(() => ({ taskId: "task-9", state, reviewReason }) as never),
		sendTaskSessionInput,
	} as unknown as NKleinTaskSessionService;
	return { service, sendTaskSessionInput };
}

describe("handleAnswerPlanQuestion (F1.3d)", () => {
	it("persists the answer and resumes the exact parked card with the resume prompt", async () => {
		const workspacePath = await createPlanWorkspace("task-9");
		const { service, sendTaskSessionInput } = fakeService("awaiting_review", "attention");
		const response = await handleAnswerPlanQuestion(
			{ workspaceId: "ws", workspacePath } as never,
			{ planSlug: "plan", questionId: "q-1", selectedOptionIds: ["default"] },
			{ getScopedNKleinTaskSessionService: async () => service },
		);
		expect(response).toMatchObject({ ok: true, questionStatus: "answered", resumedTaskId: "task-9" });
		expect(sendTaskSessionInput).toHaveBeenCalledTimes(1);
		const [taskId, prompt] = sendTaskSessionInput.mock.calls[0] as unknown as [string, string];
		expect(taskId).toBe("task-9");
		expect(prompt).toContain("Which port should the dev server bind?");
		expect(prompt).toContain("Answer: 4173");
		expect(prompt).toContain("do NOT re-ask");
	});

	it("records the answer but reports when the parked card is not cleanly re-promptable", async () => {
		const workspacePath = await createPlanWorkspace("task-9");
		const { service, sendTaskSessionInput } = fakeService("running", null);
		const response = await handleAnswerPlanQuestion(
			{ workspaceId: "ws", workspacePath } as never,
			{ planSlug: "plan", questionId: "q-1", freeText: "Use 8080." },
			{ getScopedNKleinTaskSessionService: async () => service },
		);
		expect(response.ok).toBe(true);
		expect(response.questionStatus).toBe("answered");
		expect(response.resumedTaskId).toBeNull();
		expect(response.error).toMatch(/not in a cleanly re-promptable state/);
		expect(sendTaskSessionInput).not.toHaveBeenCalled();
	});

	it("treats an empty submission as no answer and never resumes; unknown question fails", async () => {
		const workspacePath = await createPlanWorkspace("task-9");
		const { service, sendTaskSessionInput } = fakeService("awaiting_review", "attention");
		const empty = await handleAnswerPlanQuestion(
			{ workspaceId: "ws", workspacePath } as never,
			{ planSlug: "plan", questionId: "q-1", freeText: "   " },
			{ getScopedNKleinTaskSessionService: async () => service },
		);
		expect(empty).toMatchObject({ ok: true, questionStatus: "open", resumedTaskId: null });
		expect(sendTaskSessionInput).not.toHaveBeenCalled();

		const missing = await handleAnswerPlanQuestion(
			{ workspaceId: "ws", workspacePath } as never,
			{ planSlug: "plan", questionId: "q-nope", freeText: "x" },
			{ getScopedNKleinTaskSessionService: async () => service },
		);
		expect(missing.ok).toBe(false);
	});
});

describe("handleListPlanQuestions (F1.4 data layer)", () => {
	it("lists open questions by default and everything with openOnly false; unknown plan fails", async () => {
		const workspacePath = await createPlanWorkspace(null);
		const openOnly = await handleListPlanQuestions({ workspaceId: "ws", workspacePath } as never, {
			planSlug: "plan",
		});
		expect(openOnly.ok).toBe(true);
		expect(openOnly.questions.map((question) => question.id)).toEqual(["q-1"]);

		await handleAnswerPlanQuestion(
			{ workspaceId: "ws", workspacePath } as never,
			{ planSlug: "plan", questionId: "q-1", freeText: "4173." },
			{ getScopedNKleinTaskSessionService: async () => ({ getSummary: () => null }) as never },
		);
		const afterAnswer = await handleListPlanQuestions({ workspaceId: "ws", workspacePath } as never, {
			planSlug: "plan",
		});
		expect(afterAnswer.questions).toEqual([]);
		const all = await handleListPlanQuestions({ workspaceId: "ws", workspacePath } as never, {
			planSlug: "plan",
			openOnly: false,
		});
		expect(all.questions[0]).toMatchObject({ id: "q-1", status: "answered", answer: "4173." });

		const missing = await handleListPlanQuestions({ workspaceId: "ws", workspacePath } as never, {
			planSlug: "no-such-plan",
		});
		expect(missing.ok).toBe(false);
	});
});
