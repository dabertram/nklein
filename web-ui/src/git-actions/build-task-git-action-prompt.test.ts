import { describe, expect, it } from "vitest";

import {
	buildTaskGitActionPrompt,
	TASK_GIT_BASE_REF_PROMPT_VARIABLE,
} from "@/git-actions/build-task-git-action-prompt";

describe("buildTaskGitActionPrompt", () => {
	it("interpolates the shared base ref variable into custom templates", () => {
		expect(
			buildTaskGitActionPrompt({
				action: "commit",
				gitContext: { baseRef: "main" },
				templates: {
					commitPromptTemplate: `Commit onto ${TASK_GIT_BASE_REF_PROMPT_VARIABLE.token}.`,
				},
			}),
		).toBe("Commit onto main.");
	});

	it("falls back to the default action prompt when no template is configured", () => {
		expect(
			buildTaskGitActionPrompt({
				action: "pr",
				gitContext: { baseRef: "main" },
			}),
		).toBe("Handle this pull request action using the provided git context.");
	});
});
