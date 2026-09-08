/**
 * Repository-scoped git environment variables.
 *
 * Git exports several of these to hooks (notably `GIT_INDEX_FILE` and `GIT_DIR`), and any `git`
 * process we spawn inherits them. That silently retargets our command at the *outer* repository:
 * a `git add` in a temporary repo then writes its entry into the outer commit's index while the
 * blob lands in the temp repo's object store, and the outer commit dies with
 * "error: invalid object <mode> <oid> for '<path>' / error: Error building trees".
 *
 * Stripping them makes every git invocation depend only on its explicit `cwd` / `-C` argument.
 * Callers that genuinely want one of these (see `workspace/turn-checkpoints.ts`, which points git
 * at a scratch index) pass it back through the `overrides` argument.
 */
export const GIT_REPOSITORY_ENV_KEYS = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_PREFIX",
	// Not hook-exported, but they redirect config lookup and repository discovery just as hard.
	"GIT_CONFIG",
	"GIT_CEILING_DIRECTORIES",
] as const;

const GIT_REPOSITORY_ENV_KEY_SET: ReadonlySet<string> = new Set(GIT_REPOSITORY_ENV_KEYS);

function isGitRepositoryEnvKey(key: string): boolean {
	return GIT_REPOSITORY_ENV_KEY_SET.has(key);
}

/** Copy of `source` without any repository-scoped git variable. */
export function stripGitRepositoryEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const sanitized: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(source)) {
		if (isGitRepositoryEnvKey(key)) {
			continue;
		}
		sanitized[key] = value;
	}
	return sanitized;
}

/**
 * Deletes the repository-scoped git variables from this process's own environment, so child
 * processes started *without* an explicit `env` inherit a clean one too. Returns the removed pairs.
 */
export function purgeGitRepositoryEnv(target: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const removed: NodeJS.ProcessEnv = {};
	for (const key of GIT_REPOSITORY_ENV_KEYS) {
		const value = target[key];
		if (value === undefined) {
			continue;
		}
		removed[key] = value;
		delete target[key];
	}
	return removed;
}

export function createGitProcessEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return {
		...stripGitRepositoryEnv(process.env),
		...overrides,
	};
}
