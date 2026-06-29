import { describe, expect, it } from "vitest";
import {
	applyThinkingDisable,
	getThinkingControl,
	supportsThinkingControl,
} from "../../../src/core/model-thinking-control";

describe("getThinkingControl / supportsThinkingControl", () => {
	it("recognizes Qwen3's /no_think soft switch (live-verified) but not non-reasoning qwen variants", () => {
		expect(getThinkingControl("qwen/qwen3-8b")).toEqual({ disableToken: "/no_think", enableToken: "/think" });
		expect(supportsThinkingControl("qwen3-30b-a3b")).toBe(true);
		// qwen2.5-coder is NOT a reasoning model — no switch.
		expect(getThinkingControl("qwen2.5-coder-14b")).toBeNull();
		expect(supportsThinkingControl("phi-4-mini")).toBe(false);
	});
});

describe("applyThinkingDisable", () => {
	it("appends the disable token for a supported model", () => {
		expect(applyThinkingDisable("Create a card titled X.", "qwen/qwen3-8b")).toBe(
			"Create a card titled X. /no_think",
		);
	});

	it("is a no-op for a model without a known switch", () => {
		expect(applyThinkingDisable("Do the thing.", "qwen2.5-coder-14b")).toBe("Do the thing.");
	});

	it("does not double-append when the switch is already present", () => {
		const once = applyThinkingDisable("Go. /no_think", "qwen/qwen3-8b");
		expect(once).toBe("Go. /no_think");
	});
});
