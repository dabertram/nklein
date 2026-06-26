import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	appendNKleinPlanRevision,
	nkleinPlanTaskGraphSchema,
	readNKleinPlanArtifacts,
	resolveNKleinPlanArtifactPaths,
	updateNKleinPlanArtifactApplicationStatus,
	writeNKleinPlanArtifacts,
} from "../../../src/nklein-agent/nklein-plan-artifacts";

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));

vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

async function createWorkspace(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-plan-artifacts-"));
}

describe("nklein plan artifacts", () => {
	beforeEach(() => {
		selfObservationMocks.recordSelfObservation.mockReset();
	});

	it("normalizes slugs into the workspace plan directory", async () => {
		const workspacePath = await createWorkspace();
		const paths = resolveNKleinPlanArtifactPaths(workspacePath, " Habit Tracker PWA ");

		expect(paths.slug).toBe("habit-tracker-pwa");
		expect(paths.rootPath).toBe(join(workspacePath, ".nklein", "nklein", "plans", "habit-tracker-pwa"));
		expect(paths.decisionsPath).toBe(
			join(workspacePath, ".nklein", "nklein", "plans", "habit-tracker-pwa", "decisions.md"),
		);
		expect(paths.revisionsPath).toBe(
			join(workspacePath, ".nklein", "nklein", "plans", "habit-tracker-pwa", "revisions.md"),
		);
	});

	it("applies task graph defaults", () => {
		const graph = nkleinPlanTaskGraphSchema.parse({
			schemaVersion: 1,
			slug: "demo",
			title: "Demo",
			tasks: [
				{
					id: "task-1",
					title: "Task",
					prompt: "Do it",
				},
			],
		});

		expect(graph.tasks[0]).toMatchObject({
			dependsOn: [],
			complexity: 50,
			suggestedRole: null,
			filesLikelyTouched: [],
			acceptanceCommand: null,
			testFirst: false,
			acceptanceTestPrompt: null,
		});
	});

	it("writes and reads spec, plan, and task graph artifacts", async () => {
		const workspacePath = await createWorkspace();
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "Habit Tracker",
			spec: "# Spec\n",
			plan: "# Plan\n",
			summary: "# Summary\n\nBuild habit storage in one step.",
			questions: [
				{
					id: "q1",
					question: "Should reminders be included?",
					status: "assumed-default",
					options: [
						{
							id: "no",
							label: "No reminders",
							description: "Keep the first slice focused.",
							recommended: true,
						},
					],
					answer: null,
					assumption: "No reminders in the first slice.",
				},
			],
			taskGraph: {
				schemaVersion: 1,
				slug: "will-be-normalized",
				title: "Habit Tracker",
				tasks: [
					{
						id: "task-1",
						title: "Create storage",
						prompt: "Implement storage.",
						dependsOn: [],
						complexity: 30,
						suggestedRole: "worker",
						filesLikelyTouched: ["src/storage.ts"],
						acceptanceCommand: "npm test",
						testFirst: true,
						acceptanceTestPrompt: "Add a storage persistence test before implementing the storage adapter.",
					},
				],
			},
		});

		const artifacts = await readNKleinPlanArtifacts(workspacePath, "habit-tracker");

		expect(artifacts.spec).toBe("# Spec\n");
		expect(artifacts.plan).toBe("# Plan\n");
		expect(artifacts.summary).toBe("# Summary\n\nBuild habit storage in one step.\n");
		expect(artifacts.questionsMarkdown).toContain("Should reminders be included?");
		expect(artifacts.questionsMarkdown).toContain("Assumption: No reminders in the first slice.");
		expect(artifacts.decisionsMarkdown).toContain("# Decisions");
		expect(artifacts.decisionsMarkdown).toContain("Assumption: No reminders in the first slice.");
		expect(artifacts.revisionsMarkdown).toContain("No plan revisions");
		await expect(readFile(artifacts.questionsPath, "utf8")).resolves.toContain("# Questions");
		await expect(readFile(artifacts.decisionsPath, "utf8")).resolves.toContain("No reminders in the first slice");
		await expect(readFile(artifacts.revisionsPath, "utf8")).resolves.toContain("# Revisions");
		await expect(readFile(artifacts.summaryPath, "utf8")).resolves.toContain("Build habit storage");
		await expect(readFile(artifacts.metadataPath, "utf8")).resolves.toContain('"artifactId"');
		expect(artifacts.artifactId).toBe("decomposition:habit-tracker");
		expect(artifacts.metadata).toMatchObject({
			artifactId: "decomposition:habit-tracker",
			workspaceId: null,
			workspacePath,
			sourceTaskId: null,
			artifactKind: "decomposition",
			planSlug: "habit-tracker",
			validationStatus: "valid",
			applicationStatus: "pending",
		});
		expect(artifacts.taskGraph.slug).toBe("habit-tracker");
		expect(artifacts.taskGraph.tasks[0]?.filesLikelyTouched).toEqual(["src/storage.ts"]);
		expect(artifacts.taskGraph.tasks[0]?.testFirst).toBe(true);
		expect(artifacts.taskGraph.tasks[0]?.acceptanceTestPrompt).toContain("storage persistence test");

		const updatedMetadata = await updateNKleinPlanArtifactApplicationStatus({
			workspacePath,
			slug: "habit-tracker",
			applicationStatus: "applied",
			sourceTaskId: "source-card",
			updatedAt: 123,
		});
		expect(updatedMetadata.applicationStatus).toBe("applied");
		expect(updatedMetadata.sourceTaskId).toBe("source-card");
		expect(updatedMetadata.updatedAt).toBe(123);
		const updatedArtifacts = await readNKleinPlanArtifacts(workspacePath, "habit-tracker");
		expect(updatedArtifacts.metadata.applicationStatus).toBe("applied");
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				message: "Plan artifact created: decomposition:habit-tracker",
				workspacePath,
				metadata: expect.objectContaining({
					operation: "plan_artifact_lifecycle",
					stage: "created",
					artifactId: "decomposition:habit-tracker",
					planSlug: "habit-tracker",
					taskCount: 1,
					dependencyCount: 0,
				}),
			}),
		);
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				message: "Plan artifact applied: decomposition:habit-tracker",
				taskId: "source-card",
				workspacePath,
				metadata: expect.objectContaining({
					operation: "plan_artifact_lifecycle",
					stage: "applied",
					artifactId: "decomposition:habit-tracker",
					planSlug: "habit-tracker",
					applicationStatus: "applied",
				}),
			}),
		);
	});

	it("records lifecycle telemetry when artifacts are rejected", async () => {
		const workspacePath = await createWorkspace();
		await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "Reject Me",
			spec: "# Spec\n",
			plan: "# Plan\n",
			taskGraph: {
				schemaVersion: 1,
				slug: "reject-me",
				title: "Reject Me",
				tasks: [
					{
						id: "task-1",
						title: "Create storage",
						prompt: "Implement storage.",
						dependsOn: [],
						complexity: 30,
						suggestedRole: "worker",
						filesLikelyTouched: ["src/storage.ts"],
						acceptanceCommand: "npm test",
						testFirst: false,
						acceptanceTestPrompt: null,
					},
				],
			},
		});
		selfObservationMocks.recordSelfObservation.mockReset();

		await updateNKleinPlanArtifactApplicationStatus({
			workspacePath,
			slug: "reject-me",
			applicationStatus: "rejected",
			sourceTaskId: "source-card",
			updatedAt: 456,
		});

		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				message: "Plan artifact rejected: decomposition:reject-me",
				taskId: "source-card",
				workspacePath,
				metadata: expect.objectContaining({
					operation: "plan_artifact_lifecycle",
					stage: "rejected",
					artifactId: "decomposition:reject-me",
					planSlug: "reject-me",
					applicationStatus: "rejected",
					taskCount: 1,
					dependencyCount: 0,
				}),
			}),
		);
	});

	it("appends concrete revision entries to the plan audit trail", async () => {
		const workspacePath = await createWorkspace();
		const artifacts = await writeNKleinPlanArtifacts({
			workspacePath,
			slug: "checkout-rework",
			spec: "# Spec\n",
			plan: "# Plan\n",
			taskGraph: {
				schemaVersion: 1,
				slug: "checkout-rework",
				title: "Checkout Rework",
				tasks: [
					{
						id: "api-client",
						title: "API client",
						prompt: "Build the API client.",
						dependsOn: [],
						complexity: 50,
						suggestedRole: null,
						filesLikelyTouched: [],
						acceptanceCommand: null,
						testFirst: false,
						acceptanceTestPrompt: null,
					},
				],
			},
		});

		const revisionsPath = await appendNKleinPlanRevision({
			workspacePath,
			slug: "checkout-rework",
			taskId: "api-client",
			kind: "missing_dependency",
			description: "API client needs auth types that were not planned.",
			evidence: "src/auth/types.ts is missing.",
			createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
		});

		expect(revisionsPath).toBe(artifacts.revisionsPath);
		const revisionsMarkdown = await readFile(revisionsPath, "utf8");
		expect(revisionsMarkdown).toContain("# Revisions");
		expect(revisionsMarkdown).not.toContain("No plan revisions");
		expect(revisionsMarkdown).toContain("2026-01-02T03:04:05.000Z - missing_dependency");
		expect(revisionsMarkdown).toContain("Task: api-client");
		expect(revisionsMarkdown).toContain("API client needs auth types");
		expect(revisionsMarkdown).toContain("Evidence: src/auth/types.ts is missing.");
	});
});
