import { describe, expect, it, vi } from "vitest";
import { runDesktopAutoResume } from "../src/auto-resume-runner.js";
import type { DesktopRuntimeControlClient } from "../src/runtime-control.js";

function client(overrides: Partial<DesktopRuntimeControlClient>): DesktopRuntimeControlClient {
	return {
		listProjects: vi.fn(async () => ({ projects: [] })),
		getTrayState: vi.fn(),
		resumeProject: vi.fn(async (workspaceId: string) => ({
			workspaceId,
			resumedTaskIds: [],
			skippedTaskIds: [],
			errors: [],
		})),
		togglePause: vi.fn(),
		...overrides,
	};
}

describe("runDesktopAutoResume", () => {
	it("resumes only selected flagged projects, capped to one by default", async () => {
		const resumeProject = vi.fn(async (workspaceId: string) => ({
			workspaceId,
			resumedTaskIds: ["task-1"],
			skippedTaskIds: [],
			errors: [],
		}));
		const runtimeClient = client({
			listProjects: vi.fn(async () => ({
				projects: [
					{ id: "old", autoResumeEnabled: true, lastActiveAt: 10 },
					{ id: "off", autoResumeEnabled: false, lastActiveAt: 30 },
					{ id: "new", autoResumeEnabled: true, lastActiveAt: 20 },
				],
			})),
			resumeProject,
		});

		await expect(runDesktopAutoResume({ client: runtimeClient })).resolves.toEqual({
			selectedProjectIds: ["new"],
			results: [{ workspaceId: "new", resumedTaskIds: ["task-1"], skippedTaskIds: [], errors: [] }],
			errors: [],
		});
		expect(resumeProject).toHaveBeenCalledWith("new");
	});

	it("continues when one selected project fails", async () => {
		const resumeProject = vi.fn(async (workspaceId: string) => {
			if (workspaceId === "a") {
				throw new Error("resume failed");
			}
			return { workspaceId, resumedTaskIds: [], skippedTaskIds: [], errors: [] };
		});
		const runtimeClient = client({
			listProjects: vi.fn(async () => ({
				projects: [
					{ id: "a", autoResumeEnabled: true, lastActiveAt: 20 },
					{ id: "b", autoResumeEnabled: true, lastActiveAt: 10 },
				],
			})),
			resumeProject,
		});

		await expect(runDesktopAutoResume({ client: runtimeClient, maxConcurrentProjects: 2 })).resolves.toEqual({
			selectedProjectIds: ["a", "b"],
			results: [{ workspaceId: "b", resumedTaskIds: [], skippedTaskIds: [], errors: [] }],
			errors: [{ workspaceId: "a", error: "resume failed" }],
		});
	});
});
