import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeTaskContextImportResponse } from "../../core/api-contract";
import {
	formatGitHubContextLabel,
	type GitHubIssueView,
	parseGitHubContextTarget,
	renderGitHubIssueContext,
} from "../../core/task-context-import";

/**
 * GitHub context import for the `nklein task` "import context" action, extracted from the oversized `runtime-api.ts`
 * (todo §5.U). Shells out to the `gh` CLI to pull an issue (title/body/comments) or a PR diff for a task target and
 * renders it into a `RuntimeTaskContextImportResponse`. Kept separate so `createRuntimeApi` just dispatches to the
 * right importer.
 */

const execFileAsync = promisify(execFile);

const GITHUB_CONTEXT_IMPORT_TIMEOUT_MS = 20_000;
const GITHUB_CONTEXT_IMPORT_MAX_BUFFER_BYTES = 512_000;

async function runGitHubCli(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		timeout: GITHUB_CONTEXT_IMPORT_TIMEOUT_MS,
		maxBuffer: GITHUB_CONTEXT_IMPORT_MAX_BUFFER_BYTES,
	});
	return stdout.toString();
}

export async function importGitHubIssueContext(
	targetText: string,
	cwd: string,
): Promise<RuntimeTaskContextImportResponse> {
	const target = parseGitHubContextTarget(targetText);
	const sourceLabel = formatGitHubContextLabel("github_issue", target);
	const stdout = await runGitHubCli(
		[
			"issue",
			"view",
			target.number,
			"--repo",
			`${target.owner}/${target.repo}`,
			"--json",
			"title,body,comments,url,state,labels",
		],
		cwd,
	);
	const issue = JSON.parse(stdout) as GitHubIssueView;
	const content = renderGitHubIssueContext(issue);
	if (!content) {
		throw new Error("GitHub issue returned no importable content.");
	}
	return {
		ok: true,
		sourceLabel,
		title: issue.title?.trim() || null,
		content,
	};
}

export async function importGitHubPrDiffContext(
	targetText: string,
	cwd: string,
): Promise<RuntimeTaskContextImportResponse> {
	const target = parseGitHubContextTarget(targetText);
	const sourceLabel = formatGitHubContextLabel("github_pr_diff", target);
	const content = (
		await runGitHubCli(["pr", "diff", target.number, "--repo", `${target.owner}/${target.repo}`], cwd)
	).trim();
	if (!content) {
		throw new Error("GitHub PR diff returned no importable content.");
	}
	return {
		ok: true,
		sourceLabel,
		title: null,
		content,
	};
}
