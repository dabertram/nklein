import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTaskKnowledgeDebtPresent } from "../../../src/nklein-agent/nklein-ledger-attempt";
import { writeNKleinPlanArtifacts } from "../../../src/nklein-agent/nklein-plan-artifacts";
import { loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-ledger-debt-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

const planTask = (id: string, knowledgeDebt: string | null) => ({
	id,
	title: `Task ${id}`,
	prompt: `Do ${id}`,
	dependsOn: [],
	complexity: 40,
	suggestedRole: null,
	filesLikelyTouched: [],
	acceptanceCommand: null,
	testFirst: false,
	acceptanceTestPrompt: null,
	knowledgeDebt,
});

describe("resolveTaskKnowledgeDebtPresent (F1.1)", () => {
	it("resolves declared debt / no debt for plan-born cards and null for unknowns", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-ledger-debt-ws-");
			try {
				const workspacePath = join(sandboxRoot, "repo");
				mkdirSync(workspacePath, { recursive: true });
				const init = spawnSync("git", ["init"], { cwd: workspacePath, stdio: "ignore", env: createGitTestEnv() });
				if (init.status !== 0) {
					throw new Error("git init failed");
				}
				await writeNKleinPlanArtifacts({
					workspacePath,
					slug: "debt-plan",
					spec: "spec",
					plan: "plan",
					taskGraph: {
						schemaVersion: 1 as const,
						slug: "debt-plan",
						title: "Debt plan",
						tasks: [planTask("with-debt", "How does the audio engine schedule voices?"), planTask("clean", null)],
					},
				});
				const initial = await loadWorkspaceState(workspacePath);
				const card = (id: string, planTaskId: string) => ({
					id,
					title: id,
					prompt: id,
					startInPlanMode: false,
					baseRef: "main",
					createdAt: 1,
					updatedAt: 1,
					generatedFromPlan: {
						artifactKind: "decomposition" as const,
						planSlug: "debt-plan",
						planTaskId,
					},
				});
				await saveWorkspaceState(workspacePath, {
					board: {
						columns: [
							{
								id: "backlog" as const,
								title: "Backlog",
								cards: [card("card-debt", "with-debt"), card("card-clean", "clean")],
							},
							{ id: "planning" as const, title: "Planning", cards: [] },
							{ id: "in_progress" as const, title: "In Progress", cards: [] },
							{ id: "review" as const, title: "Review", cards: [] },
							{ id: "completed" as const, title: "Completed", cards: [] },
							{ id: "trash" as const, title: "Trash", cards: [] },
						],
						dependencies: [],
					},
					expectedRevision: initial.revision,
				});

				await expect(resolveTaskKnowledgeDebtPresent(workspacePath, "card-debt")).resolves.toBe(true);
				await expect(resolveTaskKnowledgeDebtPresent(workspacePath, "card-clean")).resolves.toBe(false);
				// Not plan-born / unknown card / missing workspace ⇒ null, never "no debt".
				await expect(resolveTaskKnowledgeDebtPresent(workspacePath, "no-such-card")).resolves.toBeNull();
				await expect(resolveTaskKnowledgeDebtPresent(null, "card-debt")).resolves.toBeNull();
			} finally {
				cleanup();
			}
		});
	});
});
