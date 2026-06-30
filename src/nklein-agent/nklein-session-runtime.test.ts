import { describe, expect, it } from "vitest";

import { buildNKleinContextCompactionConfig } from "./nklein-session-runtime";

describe("buildNKleinContextCompactionConfig", () => {
	it("passes the active model context window to SDK auto-compaction", () => {
		expect(buildNKleinContextCompactionConfig(80_000)).toEqual({
			enabled: true,
			strategy: "basic",
			maxInputTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
	});

	it("uses a conservative context window when the model window is unknown", () => {
		expect(buildNKleinContextCompactionConfig(null)).toEqual({
			enabled: true,
			strategy: "basic",
			maxInputTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
		expect(buildNKleinContextCompactionConfig(0)).toEqual({
			enabled: true,
			strategy: "basic",
			maxInputTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
	});
});
