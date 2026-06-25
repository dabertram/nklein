import { mkdirSync } from "node:fs";

import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { saveWorkspaceState } from "../../../src/state/workspace-state";
import { initGitRepository } from "../helpers/git";

export function createBoard(title: string): RuntimeBoardData {
	const now = Date.now();
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						title: title,
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

export async function seedWorkspace(options: { cwd: string; homeDir: string }): Promise<void> {
	mkdirSync(options.cwd, { recursive: true });
	initGitRepository(options.cwd);

	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = options.homeDir;
	process.env.USERPROFILE = options.homeDir;
	try {
		await saveWorkspaceState(options.cwd, {
			board: createBoard("Seed Task"),
		});
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
	}
}
