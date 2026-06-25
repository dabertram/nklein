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
		// `packages/**` excluded: those workspaces have their own vitest
		// configs and runtime shapes (e.g. Electron) and are run explicitly by
		// CI. New workspaces under `packages/` MUST get matching install/test
		// steps in .github/workflows/test.yml or they fall out of CI coverage.
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
