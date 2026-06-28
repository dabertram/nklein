import { defineConfig } from "vitest/config";
import { nkleinSdkViteAlias } from "./scripts/nklein-sdk-alias.mjs";

process.env.NODE_ENV = "production";

export default defineConfig({
	resolve: {
		alias: nkleinSdkViteAlias,
	},
	test: {
		globals: true,
		environment: "node",
		// Isolate every test file's HOME to a throwaway dir (see the setup file) so home-based runtime state + locks never
		// touch the real `~/.nklein` — which also stops the suite contending with a running dev:full instance's lock.
		setupFiles: ["./test/vitest-setup-home.ts"],
		// `packages/**` excluded: those workspaces have their own vitest
		// configs and runtime shapes (e.g. Electron) and are run explicitly.
		// New workspaces under `packages/` need their own install/test wiring
		// (and must be added to CI once CI is set up — todo.md §5.J).
		exclude: [
			"apps/**",
			"packages/**",
			"web-ui/**",
			"third_party/**",
			"**/node_modules/**",
			"**/dist/**",
			".worktrees/**",
			// Agent worktrees live under `.claude/worktrees/<id>/` (full repo checkouts). Without this, a bare
			// `vitest run test/runtime` substring-matches their test copies (and their `packages/**` tests), so the
			// suite balloons ~4× and picks up other branches' in-progress code. Never recurse into them.
			".claude/**",
			"**/.claude/**",
		],
		testTimeout: 15_000,
	},
});
