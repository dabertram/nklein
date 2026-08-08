import { defineConfig } from "@playwright/test";

/**
 * N14 — the OPERATOR-BOUNCE journey lane: a live sim-backed runtime (no drained copy — the journey CREATES
 * its card, drives the sim worker, and merges through the UI). `scripts/ui-journey-bounce.mts` owns the
 * servers and passes the base URL in; no webServer block on purpose.
 */
export default defineConfig({
	testDir: "./tests-bounce",
	timeout: 120_000,
	use: {
		baseURL: process.env.NKLEIN_E2E_BASE_URL ?? "http://127.0.0.1:4595",
		headless: true,
	},
});
