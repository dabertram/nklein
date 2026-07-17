import { describe, expect, it } from "vitest";
import {
	createToolTrustState,
	recordToolOutcome,
	toolTrustGuidance,
	toolTrustTier,
} from "../../../src/core/tool-trust-decay";

describe("tool trust decay (F12.24)", () => {
	it("demotes at 3 consecutive failures and drops at 5", () => {
		const state = createToolTrustState();
		expect(recordToolOutcome(state, "edit_file", false)).toBe("trusted");
		expect(recordToolOutcome(state, "edit_file", false)).toBe("trusted");
		expect(recordToolOutcome(state, "edit_file", false)).toBe("demoted");
		expect(recordToolOutcome(state, "edit_file", false)).toBe("demoted");
		expect(recordToolOutcome(state, "edit_file", false)).toBe("dropped");
		expect(toolTrustTier(state, "edit_file")).toBe("dropped");
	});

	it("resets the streak on ANY success — decay is about the current struggle", () => {
		const state = createToolTrustState();
		recordToolOutcome(state, "edit_file", false);
		recordToolOutcome(state, "edit_file", false);
		expect(recordToolOutcome(state, "edit_file", true)).toBe("trusted");
		expect(recordToolOutcome(state, "edit_file", false)).toBe("trusted");
	});

	it("tracks tools independently and renders tier guidance with the alternative", () => {
		const state = createToolTrustState();
		for (let i = 0; i < 5; i += 1) {
			recordToolOutcome(state, "edit_file", false);
		}
		expect(toolTrustTier(state, "write_files")).toBe("trusted");
		expect(toolTrustGuidance("demoted", "edit_file")).toContain("EXACTLY");
		expect(toolTrustGuidance("dropped", "edit_file", { alternative: "write_files" })).toContain(
			"use write_files instead",
		);
		expect(toolTrustGuidance("trusted", "edit_file")).toBeNull();
	});
});
