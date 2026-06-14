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

	it("does not enable context compaction when the model window is unknown", () => {
		expect(buildClineContextCompactionConfig(null)).toBeUndefined();
		expect(buildClineContextCompactionConfig(0)).toBeUndefined();
	});
});
