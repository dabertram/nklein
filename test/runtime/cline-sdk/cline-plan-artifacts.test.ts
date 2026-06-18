import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	clinePlanTaskGraphSchema,
	readClinePlanArtifacts,
	resolveClinePlanArtifactPaths,
	writeClinePlanArtifacts,
} from "../../../src/cline-sdk/cline-plan-artifacts";

async function createWorkspace(): Promise<string> {
	return await mkdtemp(join(tmpdir(), "kanban-plan-artifacts-"));
}

describe("cline plan artifacts", () => {
	it("normalizes slugs into the workspace plan directory", async () => {
		const workspacePath = await createWorkspace();
		const paths = resolveClinePlanArtifactPaths(workspacePath, " Habit Tracker PWA ");

		expect(paths.slug).toBe("habit-tracker-pwa");
		expect(paths.rootPath).toBe(join(workspacePath, ".cline", "kanban", "plans", "habit-tracker-pwa"));
	});

	it("applies task graph defaults", () => {
		const graph = clinePlanTaskGraphSchema.parse({
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
		await writeClinePlanArtifacts({
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

		const artifacts = await readClinePlanArtifacts(workspacePath, "habit-tracker");

		expect(artifacts.spec).toBe("# Spec\n");
		expect(artifacts.plan).toBe("# Plan\n");
		expect(artifacts.summary).toBe("# Summary\n\nBuild habit storage in one step.\n");
		expect(artifacts.questionsMarkdown).toContain("Should reminders be included?");
		expect(artifacts.questionsMarkdown).toContain("Assumption: No reminders in the first slice.");
		await expect(readFile(artifacts.questionsPath, "utf8")).resolves.toContain("# Questions");
		await expect(readFile(artifacts.summaryPath, "utf8")).resolves.toContain("Build habit storage");
		expect(artifacts.taskGraph.slug).toBe("habit-tracker");
		expect(artifacts.taskGraph.tasks[0]?.filesLikelyTouched).toEqual(["src/storage.ts"]);
		expect(artifacts.taskGraph.tasks[0]?.testFirst).toBe(true);
		expect(artifacts.taskGraph.tasks[0]?.acceptanceTestPrompt).toContain("storage persistence test");
	});
});
