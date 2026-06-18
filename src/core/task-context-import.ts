export type TaskContextImportSource = "github_issue" | "github_pr_diff";

export interface GitHubContextTarget {
	owner: string;
	repo: string;
	number: string;
}

export interface GitHubIssueView {
	title?: string | null;
	body?: string | null;
	url?: string | null;
	state?: string | null;
	labels?: Array<{ name?: string | null }> | null;
	comments?: Array<{ author?: { login?: string | null } | null; body?: string | null }> | null;
}

const GITHUB_SHORTHAND_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/u;

export function parseGitHubContextTarget(value: string): GitHubContextTarget {
	const target = value.trim();
	const shorthandMatch = GITHUB_SHORTHAND_PATTERN.exec(target);
	if (shorthandMatch) {
		const [, owner, repo, number] = shorthandMatch;
		if (!owner || !repo || !number) {
			throw new Error("Use a GitHub URL or owner/repo#number.");
		}
		return {
			owner,
			repo,
			number,
		};
	}

	let url: URL;
	try {
		url = new URL(target);
	} catch {
		throw new Error("Use a GitHub URL or owner/repo#number.");
	}
	if (url.hostname !== "github.com") {
		throw new Error("Only github.com URLs are supported.");
	}
	const [owner, repo, kind, number] = url.pathname.split("/").filter(Boolean);
	if (!owner || !repo || !kind || !number || !/^\d+$/u.test(number)) {
		throw new Error("Use a GitHub issue or pull request URL.");
	}
	if (kind !== "issues" && kind !== "pull") {
		throw new Error("Use a GitHub issue or pull request URL.");
	}
	return { owner, repo, number };
}

export function formatGitHubContextLabel(source: TaskContextImportSource, target: GitHubContextTarget): string {
	const kind = source === "github_issue" ? "issue" : "PR diff";
	return `GitHub ${kind} ${target.owner}/${target.repo}#${target.number}`;
}

export function renderGitHubIssueContext(issue: GitHubIssueView): string {
	const lines: string[] = [];
	const title = issue.title?.trim();
	const state = issue.state?.trim();
	const url = issue.url?.trim();
	if (title) {
		lines.push(`# ${title}`);
	}
	if (state || url) {
		lines.push([state ? `State: ${state}` : "", url ? `URL: ${url}` : ""].filter(Boolean).join(" | "));
	}
	const labels = issue.labels?.map((label) => label.name?.trim()).filter((name): name is string => Boolean(name));
	if (labels && labels.length > 0) {
		lines.push(`Labels: ${labels.join(", ")}`);
	}
	const body = issue.body?.trim();
	if (body) {
		lines.push("", body);
	}
	const comments = (issue.comments ?? [])
		.map((comment) => ({
			author: comment.author?.login?.trim() || "comment",
			body: comment.body?.trim() ?? "",
		}))
		.filter((comment) => comment.body);
	if (comments.length > 0) {
		lines.push("", "Comments:");
		for (const comment of comments) {
			lines.push("", `## ${comment.author}`, comment.body);
		}
	}
	return lines.join("\n").trim();
}

export function appendTaskContextBlock(prompt: string, sourceLabel: string, content: string): string {
	const trimmedPrompt = prompt.trimEnd();
	const trimmedContent = content.trim();
	const block = [`Context from ${sourceLabel}:`, "~~~text", trimmedContent, "~~~"].join("\n");
	return trimmedPrompt ? `${trimmedPrompt}\n\n${block}` : block;
}
