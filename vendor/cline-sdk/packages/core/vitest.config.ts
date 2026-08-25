import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// Vendored packages resolve each other through ALIASES, not node_modules: the vendor manifest is
	// deliberately flat ("no workspace:* protocol" — see NOTICE.md), so `@cline/shared` and friends have no
	// package link to follow. Without these the suite dies at import with "Cannot find package '@cline/shared'"
	// — which is exactly what it did (found 2026-08-25 while landing audit fixes: `test:vendor` had been
	// failing at clean HEAD, and because the pre-commit hook only runs it when vendor/** is STAGED, the
	// release-gate net this runner exists to be was silently dead). Mapped to `src` (not `dist`) so the suite
	// tests the vendored SOURCE, including our local patches, rather than a possibly-stale build.
	resolve: {
		alias: {
			"@cline/shared/db": resolve(__dirname, "../shared/src/db"),
			"@cline/shared/storage": resolve(__dirname, "../shared/src/storage"),
			"@cline/shared": resolve(__dirname, "../shared/src"),
			"@cline/llms": resolve(__dirname, "../llms/src"),
			"@cline/agents": resolve(__dirname, "../agents/src"),
			"@cline/core/telemetry": resolve(__dirname, "../core/src/services/telemetry"),
			"@cline/core/hub": resolve(__dirname, "../core/src/hub"),
			"@cline/core": resolve(__dirname, "../core/src"),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/**/*.e2e.test.ts"],
	},
});
