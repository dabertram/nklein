import { runGit } from "./git-utils";

interface InitializeRepoResult {
	ok: boolean;
	error: string | null;
}

const KANBAN_REPOSITORY_OWNER_CONFIG_KEY = "kanban.repositoryCreatedByKanban";
const KANBAN_INITIAL_COMMIT_MESSAGE = "Initial commit through !Klein";
const LEGACY_KANBAN_INITIAL_COMMIT_MESSAGE = "Initial commit through NKlein Kanban";

export async function markGitRepositoryCreatedByKanban(projectPath: string): Promise<InitializeRepoResult> {
	const result = await runGit(projectPath, ["config", "--local", KANBAN_REPOSITORY_OWNER_CONFIG_KEY, "true"]);
	if (!result.ok) {
		return {
			ok: false,
			error: result.error ?? "Failed to record Git repository ownership.",
		};
	}
	return { ok: true, error: null };
}

export async function isGitRepositoryCreatedByKanban(projectPath: string): Promise<boolean> {
	const markerResult = await runGit(projectPath, [
		"config",
		"--local",
		"--bool",
		"--get",
		KANBAN_REPOSITORY_OWNER_CONFIG_KEY,
	]);
	if (markerResult.ok) {
		return markerResult.stdout === "true";
	}

	// Migrate repositories initialized by older !Klein versions before the
	// ownership marker existed.
	const rootCommitMessages = await runGit(projectPath, ["log", "--max-parents=0", "--format=%s"]);
	const wasInitializedByKanban =
		rootCommitMessages.ok &&
		rootCommitMessages.stdout
			.split("\n")
			.some(
				(message) => message === KANBAN_INITIAL_COMMIT_MESSAGE || message === LEGACY_KANBAN_INITIAL_COMMIT_MESSAGE,
			);
	if (!wasInitializedByKanban) {
		return false;
	}

	const markerWriteResult = await markGitRepositoryCreatedByKanban(projectPath);
	return markerWriteResult.ok;
}

export async function initializeGitRepository(projectPath: string): Promise<InitializeRepoResult> {
	const result = await runGit(projectPath, ["init"]);
	if (!result.ok) {
		return {
			ok: false,
			error: result.error ?? "Failed to initialize git repository.",
		};
	}

	const commitResult = await ensureInitialCommit(projectPath);
	if (!commitResult.ok) {
		return commitResult;
	}
	return markGitRepositoryCreatedByKanban(projectPath);
}

export async function ensureInitialCommit(projectPath: string): Promise<InitializeRepoResult> {
	const headCheck = await runGit(projectPath, ["rev-parse", "--verify", "HEAD"]);
	if (headCheck.ok) {
		return { ok: true, error: null };
	}

	const addResult = await runGit(projectPath, ["add", "-A"]);
	if (!addResult.ok) {
		return {
			ok: false,
			error: addResult.error ?? "Failed to stage files for initial commit.",
		};
	}

	const commitResult = await runGit(projectPath, ["commit", "--allow-empty", "-m", KANBAN_INITIAL_COMMIT_MESSAGE]);

	if (!commitResult.ok) {
		return {
			ok: false,
			error: commitResult.error ?? "Failed to create initial commit.",
		};
	}

	return { ok: true, error: null };
}
