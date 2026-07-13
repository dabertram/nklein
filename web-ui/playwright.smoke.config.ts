import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const currentDir = dirname(fileURLToPath(import.meta.url));

/**
 * F1.38 (§5.AK) — the HERMETIC smoke config: `reuseExistingServer: false` on a STRICT dedicated port, so a UI
 * gate can never green against a stale dev server someone left running (the default config reuses :4173 outside
 * CI — fine for iteration speed, wrong for a gate). `strictPort` makes vite FAIL if 4317 is taken rather than
 * silently drifting to another port, which would reintroduce exactly the stale-server ambiguity this config
 * exists to kill. Run via `npm run e2e:smoke`.
 */
export default defineConfig({
	testDir: "./tests",
	timeout: 30_000,
	use: {
		baseURL: "http://127.0.0.1:4317",
		headless: true,
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 4317 --strictPort",
		cwd: currentDir,
		url: "http://127.0.0.1:4317",
		reuseExistingServer: false,
	},
});
