import { purgeGitRepositoryEnv } from "../src/core/git-process-env";

/**
 * Last line of defence for the whole suite.
 *
 * `npm run test:precommit` runs from the husky pre-commit hook, and git exports repository-scoped
 * variables to hooks — `GIT_INDEX_FILE` whenever it builds a temporary index (`git commit -- <path>`),
 * plus `GIT_DIR`/`GIT_PREFIX`. Any test that shells out to git inside a temp repository inherits them
 * and writes into the *outer* commit's index; the blob lives in the temp repo, so the commit fails
 * after the hook has already passed with "error: invalid object … / error: Error building trees".
 *
 * Helpers like `createGitTestEnv` pass a sanitised env explicitly, but a new test that calls
 * `spawnSync("git", …)` without one would still be exposed. Clearing the variables from the worker's
 * own `process.env` closes that gap for every child process, whether or not it opts in. Vitest runs
 * each test file in a forked worker, so this never touches the environment of the git process that
 * started the hook.
 */
purgeGitRepositoryEnv();
