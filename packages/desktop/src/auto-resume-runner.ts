import { selectAutoResumeProjects, type AutoResumeCandidate } from "./auto-resume.js";
import type {
	DesktopRuntimeControlClient,
	DesktopRuntimeProjectResumeResult,
	DesktopRuntimeProjectSummary,
} from "./runtime-control.js";

export interface DesktopAutoResumeRunResult {
	selectedProjectIds: string[];
	results: DesktopRuntimeProjectResumeResult[];
	errors: Array<{ workspaceId: string; error: string }>;
}

export interface DesktopAutoResumeRunOptions {
	client: Pick<DesktopRuntimeControlClient, "listProjects" | "resumeProject">;
	maxConcurrentProjects?: number;
}

function toCandidate(project: DesktopRuntimeProjectSummary): AutoResumeCandidate {
	return {
		projectId: project.id,
		autoResumeEnabled: project.autoResumeEnabled === true,
		...(typeof project.lastActiveAt === "number" && Number.isFinite(project.lastActiveAt)
			? { lastActiveAt: project.lastActiveAt }
			: {}),
	};
}

export async function runDesktopAutoResume(options: DesktopAutoResumeRunOptions): Promise<DesktopAutoResumeRunResult> {
	const projects = (await options.client.listProjects()).projects;
	const selectedProjectIds = selectAutoResumeProjects(projects.map(toCandidate), options.maxConcurrentProjects ?? 1);
	const results: DesktopRuntimeProjectResumeResult[] = [];
	const errors: Array<{ workspaceId: string; error: string }> = [];

	for (const workspaceId of selectedProjectIds) {
		try {
			results.push(await options.client.resumeProject(workspaceId));
		} catch (error) {
			errors.push({
				workspaceId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		selectedProjectIds,
		results,
		errors,
	};
}
