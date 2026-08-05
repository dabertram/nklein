import { defineConfig } from "@playwright/test";

/**
 * N14 — the DRAINED-BOARD journey lane. Unlike the default config (mocked runtime installed per page), these
 * specs run against a REAL runtime serving a genuinely drained board; `scripts/ui-journey-drained.mts` owns
 * booting the runtime + vite pair on a COPY of a retained drained HOME and passes the base URL in. No
 * webServer block on purpose — the launcher's servers are the test subject, not a fixture this config forks.
 */
export default defineConfig({
	testDir: "./tests-drained",
	timeout: 45_000,
	use: {
		baseURL: process.env.NKLEIN_E2E_BASE_URL ?? "http://127.0.0.1:4599",
		headless: true,
	},
});
