import { describe, expect, it, vi } from "vitest";
import { recordExecutionClarificationBlock } from "../../../src/nklein-agent/nklein-execution-clarification";

function state(card: Record<string, unknown>) {
	return { board: { columns: [{ id: "in_progress", title: "In Progress", cards: [card] }] } } as never;
}

const origin = {
	artifactKind: "decomposition" as const,
	planSlug: "feature-plan",
	planTaskId: "implement-auth",
	sourceTaskId: "seed",
};

describe("recordExecutionClarificationBlock", () => {
	it("binds a matching open plan question to the exact asking card", async () => {
		const updateQuestion = vi.fn(async () => []);
		const appendRevision = vi.fn(async () => "/tmp/revisions.md");
		const result = await recordExecutionClarificationBlock({
			workspacePath: "/workspace",
			ask: { taskId: "card-1", question: " Which auth provider? ", options: ["OIDC", "SAML"] },
			loadState: vi.fn(async () => state({ id: "card-1", generatedFromPlan: origin })) as never,
			readArtifacts: vi.fn(async () => ({
				questions: [
					{
						id: "q-auth",
						question: "Which auth provider?",
						status: "open",
						options: [],
						answer: null,
						assumption: null,
						blockedTaskId: null,
					},
				],
			})) as never,
			updateQuestion: updateQuestion as never,
			appendRevision: appendRevision as never,
			now: () => 123,
		});

		expect(result).toEqual({
			status: "recorded",
			planSlug: "feature-plan",
			questionId: "q-auth",
			created: false,
			revisionRecorded: true,
		});
		expect(updateQuestion).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: "feature-plan",
				question: expect.objectContaining({ id: "q-auth", blockedTaskId: "card-1" }),
			}),
		);
		expect(appendRevision).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "card-1", kind: "clarification_blocked" }),
		);
	});

	it("creates a plan question from a new native ask and preserves its choices", async () => {
		const updateQuestion = vi.fn(async () => []);
		const result = await recordExecutionClarificationBlock({
			workspacePath: "/workspace",
			ask: { taskId: "card-1", question: "Choose a migration window?", options: ["Night", "Night", "Weekend"] },
			loadState: vi.fn(async () => state({ id: "card-1", generatedFromPlan: origin })) as never,
			readArtifacts: vi.fn(async () => ({ questions: [] })) as never,
			updateQuestion: updateQuestion as never,
			appendRevision: vi.fn(async () => "/tmp/revisions.md") as never,
			now: () => 456,
		});

		expect(result).toMatchObject({ status: "recorded", created: true, revisionRecorded: true });
		expect(updateQuestion).toHaveBeenCalledWith(
			expect.objectContaining({
				question: expect.objectContaining({
					question: "Choose a migration window?",
					status: "open",
					blockedTaskId: "card-1",
					options: [
						{ id: "option-1", label: "Night", description: null, recommended: true },
						{ id: "option-3", label: "Weekend", description: null, recommended: false },
					],
				}),
			}),
		);
	});

	it("does not create plan artifacts for a card that was not generated from a plan", async () => {
		const readArtifacts = vi.fn();
		const result = await recordExecutionClarificationBlock({
			workspacePath: "/workspace",
			ask: { taskId: "manual-card", question: "Need input?", options: [] },
			loadState: vi.fn(async () => state({ id: "manual-card" })) as never,
			readArtifacts: readArtifacts as never,
		});

		expect(result).toEqual({ status: "skipped", reason: "not_plan_card" });
		expect(readArtifacts).not.toHaveBeenCalled();
	});

	it("rejects when the durable revision cannot be recorded", async () => {
		await expect(
			recordExecutionClarificationBlock({
				workspacePath: "/workspace",
				ask: { taskId: "card-1", question: "Which auth provider?", options: [] },
				loadState: vi.fn(async () => state({ id: "card-1", generatedFromPlan: origin })) as never,
				readArtifacts: vi.fn(async () => ({ questions: [] })) as never,
				updateQuestion: vi.fn(async () => []) as never,
				appendRevision: vi.fn(async () => {
					throw new Error("disk full");
				}) as never,
			}),
		).rejects.toThrow("disk full");
	});
});
