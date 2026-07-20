import { describe, expect, it } from "vitest";
import {
	contextFloorRemedyHint,
	evaluateNKleinContextWindowPolicy,
	isContextWindowPolicyMessage,
} from "../../../src/nklein-agent/nklein-context-window-policy";

/**
 * The message-level predicate turns an opaque "unknown_code" auto-start failure back into an operator-actionable
 * signal after the error has crossed a serialization boundary as a plain string (where `instanceof` is gone).
 * Pinned against the ACTUAL messages the policy emits, so a wording change can't silently break the classifier.
 */
describe("isContextWindowPolicyMessage", () => {
	it("matches BOTH real refusal messages the policy produces", () => {
		const tooSmall = evaluateNKleinContextWindowPolicy({
			providerId: "lmstudio",
			modelId: "m",
			contextWindow: 16_384,
		});
		const noneReported = evaluateNKleinContextWindowPolicy({
			providerId: "lmstudio",
			modelId: "m",
			contextWindow: null,
		});
		expect(tooSmall.ok).toBe(false);
		expect(noneReported.ok).toBe(false);
		// The whole point: the STRING message (not the Error) is recognizable downstream.
		expect(isContextWindowPolicyMessage(tooSmall.ok ? "" : tooSmall.message)).toBe(true);
		expect(isContextWindowPolicyMessage(noneReported.ok ? "" : noneReported.message)).toBe(true);
	});

	it("does not match unrelated failures or empty input", () => {
		expect(isContextWindowPolicyMessage("endpoint busy, retry later")).toBe(false);
		expect(isContextWindowPolicyMessage("")).toBe(false);
		expect(isContextWindowPolicyMessage(null)).toBe(false);
		expect(isContextWindowPolicyMessage(undefined)).toBe(false);
	});

	it("the remedy hint names the concrete fix (a >=32k reload)", () => {
		expect(contextFloorRemedyHint()).toMatch(/context-length 32768/);
	});
});
