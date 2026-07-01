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

	it("EXCLUDES R1 distills that are qwen3-arch but always reason (live-verified: /no_think ignored)", () => {
		// deepseek-r1-0528-qwen3-8b contains "qwen3" but ignores /no_think — must NOT get a switch.
		expect(getThinkingControl("deepseek/deepseek-r1-0528-qwen3-8b")).toBeNull();
		expect(supportsThinkingControl("deepseek/deepseek-r1-0528-qwen3-8b")).toBe(false);
		// a plain qwen3 (no r1/deepseek marker) still gets the switch.
		expect(supportsThinkingControl("qwen/qwen3-8b")).toBe(true);
	});

	it("EXCLUDES qwen3.5 — matches /qwen3/ by name but IGNORES /no_think (live-verified 2026-07-01)", () => {
		// qwen3.5 (arch qwen3_5) is NOT the qwen3 that honors the soft switch — it always reasons; no switch.
		expect(getThinkingControl("qwen3.5-9b-mlx-m4")).toBeNull();
		expect(getThinkingControl("qwen3.5-9b-mtp-q4-k-xl-legion5pro")).toBeNull();
		expect(supportsThinkingControl("qwen3.5-9b")).toBe(false);
		expect(applyThinkingDisable("Do it.", "qwen3.5-9b-mlx-m4")).toBe("Do it."); // no-op, not a false /no_think
		// the real qwen3 is unaffected by the exclusion.
		expect(supportsThinkingControl("qwen3-8b")).toBe(true);
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
