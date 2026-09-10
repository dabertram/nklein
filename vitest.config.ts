import { defineConfig } from "vitest/config";
import { clineSdkViteAlias } from "./scripts/cline-sdk-alias.mjs";

process.env.NODE_ENV = "production";

export default defineConfig({
	resolve: {
		alias: clineSdkViteAlias,
	},
	test: {
		globals: true,
		environment: "node",
		// Isolate every test file's HOME to a throwaway dir (see the setup file) so home-based runtime state + locks never
		// touch the real `~/.nklein` — which also stops the suite contending with a running dev:full instance's lock.
		// The git setup file strips inherited repository-scoped git vars (GIT_INDEX_FILE, GIT_DIR, …) from every test
		// worker, so a test that shells out to git in a temp repo can never write into the index of the commit whose
		// pre-commit hook is running the suite.
		setupFiles: ["./test/vitest-setup-home.ts", "./test/vitest-setup-git-env.ts"],
		// `packages/**` excluded: those workspaces have their own vitest
		// configs and runtime shapes (e.g. Electron) and are run explicitly.
		// New workspaces under `packages/` need their own install/test wiring
		// (and must be added to CI once CI is set up — todo.md §5.J).
		exclude: [
			"apps/**",
			"packages/**",
			"web-ui/**",
			"third_party/**",
			// The vendored Cline SDK ships its own source + tests (vendor/cline-sdk/packages/*/src/**/*.test.ts);
			// those are upstream's tests with their own setup/branding and are not part of !Klein's suite.
			"vendor/**",
			"**/node_modules/**",
			"**/dist/**",
			".worktrees/**",
			// Agent worktrees live under `.claude/worktrees/<id>/` (full repo checkouts). Without this, a bare
			// `vitest run test/runtime` substring-matches their test copies (and their `packages/**` tests), so the
			// suite balloons ~4× and picks up other branches' in-progress code. Never recurse into them.
			".claude/**",
			"**/.claude/**",
			// Dev-test project FIXTURES (templates copied into sandboxes for dev-test runs) ship their own `.test.js`
			// using node's built-in `node:test` runner — vitest collecting them just yields "No test suite found".
			// They are not part of !Klein's own test suite; exclude so `npm test` (full `vitest run`) stays clean.
			"scripts/dev-fixtures/**",
		],
		testTimeout: 15_000,
	},
});
