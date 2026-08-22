import type { FrontierResearchRunner } from "./frontier-research-runner";

/**
 * Frontier-radar runner holder — the WEB-GRAPH boundary. The tRPC router (whose static type graph web-ui
 * type-checks) reads the runner from here; the real composition (SSRF-guarded fetcher, egress chain, lms
 * runner, LocalLlmClient — a graph web-ui must never type-check) installs itself from runtime-server at
 * boot. Before installation the holder answers honestly instead of lying with empty data.
 */

let installed: FrontierResearchRunner | null = null;

export function installFrontierResearchRunner(runner: FrontierResearchRunner): void {
	installed = runner;
}

export function getFrontierRunner(): FrontierResearchRunner {
	if (installed) {
		return installed;
	}
	return {
		status: async () => ({
			running: false,
			egressEnabled: false,
			freshness: "never",
			ageDays: null,
			latestRanAt: null,
			latestFunLine: null,
		}),
		latest: async () => null,
		run: async () => ({
			started: false,
			reason: "The frontier radar is not wired in this runtime build.",
		}),
	};
}
