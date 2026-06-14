import { describe, expect, it } from "vitest";

import { buildClineContextCompactionConfig } from "./cline-session-runtime";

describe("buildClineContextCompactionConfig", () => {
	it("passes the active model context window to SDK auto-compaction", () => {
		expect(buildClineContextCompactionConfig(80_000)).toEqual({
			enabled: true,
			strategy: "basic",
			contextWindowTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
	});

	it("uses a conservative context window when the model window is unknown", () => {
		expect(buildClineContextCompactionConfig(null)).toEqual({
			enabled: true,
			strategy: "basic",
			contextWindowTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
		expect(buildClineContextCompactionConfig(0)).toEqual({
			enabled: true,
			strategy: "basic",
			contextWindowTokens: 80_000,
			reserveTokens: 16_000,
			preserveRecentTokens: 20_000,
		});
	});
});
