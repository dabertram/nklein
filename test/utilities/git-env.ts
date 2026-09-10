/**
 * Environment for a `git` process a test runs against a throwaway repository.
 *
 * Strips **every** `GIT_*` variable — a deliberate superset of the repository-scoped
 * `GIT_REPOSITORY_ENV_KEYS` that production code drops — because a test repo should also be
 * immune to an ambient `GIT_AUTHOR_*`, `GIT_TEMPLATE_DIR`, `GIT_EDITOR`, and friends. The most
 * damaging inherited variable is `GIT_INDEX_FILE`: git exports it to hooks, so a suite run from
 * the pre-commit hook would otherwise stage temp-repo blobs into the real commit's index and
 * break the commit *after* the hook passes.
 *
 * A committer identity is then supplied so `git commit` works on machines with no global config.
 */
export function createGitTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const sanitized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("GIT_")) {
			continue;
		}
		sanitized[key] = value;
	}
	return {
		...sanitized,
		GIT_AUTHOR_NAME: "Test",
		GIT_AUTHOR_EMAIL: "test@test.com",
		GIT_COMMITTER_NAME: "Test",
		GIT_COMMITTER_EMAIL: "test@test.com",
		...overrides,
	};
}
