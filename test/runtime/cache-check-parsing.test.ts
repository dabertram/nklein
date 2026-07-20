import { describe, expect, it } from "vitest";
import { assessCacheEffectiveness, parsePromptEvalTiming } from "../../src/core/prompt-cache-verification";

/**
 * P19.4 wire — the log-reading the `dev cache-check` command does, pinned. The command reads the LAST prompt-eval
 * line in each file (a warm log may contain the cold run too) and the verdict must never call a HARNESS gap a
 * success — that is the exact #15082 failure the item exists to prevent.
 */

function lastTiming(text: string) {
	let latest = null as ReturnType<typeof parsePromptEvalTiming>;
	for (const line of text.split("\n")) {
		const parsed = parsePromptEvalTiming(line);
		if (parsed) latest = parsed;
	}
	return latest;
}

describe("cache-check log reading", () => {
	it("takes the LAST prompt-eval line when a log holds several runs", () => {
		const log = ["prompt eval time = 34980.12 ms / 32000 tokens", "prompt eval time = 980.44 ms / 32000 tokens"].join(
			"\n",
		);
		expect(lastTiming(log)?.milliseconds).toBe(980.44);
	});

	it("a missing warm timing yields INDETERMINATE, never a pass", () => {
		const cold = lastTiming("prompt eval time = 34980.12 ms / 32000 tokens");
		const warm = lastTiming("no timing in this file");
		expect(warm).toBeNull();
		expect(assessCacheEffectiveness({ cold, warm }).verdict).toBe("indeterminate");
	});

	it("the flag-set-but-no-speedup case is NOT_WORKING, not a pass", () => {
		const cold = lastTiming("prompt eval time = 34980.0 ms / 32000 tokens");
		const warm = lastTiming("prompt eval time = 33500.0 ms / 32000 tokens");
		expect(assessCacheEffectiveness({ cold, warm }).verdict).toBe("not_working");
	});

	it("a genuine warm speed-up over an identical prefix is WORKING", () => {
		const cold = lastTiming("prompt eval time = 34980.0 ms / 32000 tokens");
		const warm = lastTiming("prompt eval time = 980.0 ms / 32000 tokens");
		expect(assessCacheEffectiveness({ cold, warm }).verdict).toBe("working");
	});
});
