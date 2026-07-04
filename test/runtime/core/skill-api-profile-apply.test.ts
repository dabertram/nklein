import { describe, expect, it } from "vitest";
import { applySkillApiProfileToChatCall, type ChatModelCallProfile } from "../../../src/core/skill-api-profile-apply";
import type { SkillApiProfile } from "../../../src/core/skill-registry";

const base: ChatModelCallProfile = {
	temperature: 0.3,
	reasoning: "inherit",
	forceToolCall: false,
	structuredOutput: false,
};

describe("applySkillApiProfileToChatCall (DRAFT decision-7, held for approval)", () => {
	it("a null/empty profile leaves the base UNCHANGED (inert until the resolution precursor feeds it)", () => {
		expect(applySkillApiProfileToChatCall(base, null)).toEqual(base);
		expect(applySkillApiProfileToChatCall(base, {})).toEqual(base);
	});

	it("the profile's temperature + explicit reasoning override the base", () => {
		const out = applySkillApiProfileToChatCall(base, { temperature: 0.1, reasoning: "high" });
		expect(out.temperature).toBe(0.1);
		expect(out.reasoning).toBe("high");
	});

	it("reasoning:inherit leaves the base reasoning untouched", () => {
		expect(applySkillApiProfileToChatCall({ ...base, reasoning: "low" }, { reasoning: "inherit" }).reasoning).toBe(
			"low",
		);
	});

	it("stricter-wins: forceToolCall / structuredOutput are OR-combined, never loosened", () => {
		// base already forced → stays forced even if the profile doesn't force.
		expect(applySkillApiProfileToChatCall({ ...base, forceToolCall: true }, {}).forceToolCall).toBe(true);
		// profile forces → forced even if base didn't.
		expect(applySkillApiProfileToChatCall(base, { forceToolCall: true }).forceToolCall).toBe(true);
		expect(applySkillApiProfileToChatCall(base, { structuredOutput: true }).structuredOutput).toBe(true);
	});

	it("is IDEMPOTENT — applying the profile twice equals applying it once (the no-double-apply guarantee)", () => {
		const profile: SkillApiProfile = {
			temperature: 0.2,
			reasoning: "high",
			forceToolCall: true,
			structuredOutput: true,
		};
		const once = applySkillApiProfileToChatCall(base, profile);
		const twice = applySkillApiProfileToChatCall(once, profile);
		expect(twice).toEqual(once);
	});

	it("never mutates its inputs", () => {
		const b = { ...base };
		applySkillApiProfileToChatCall(b, { temperature: 0.9, forceToolCall: true });
		expect(b).toEqual(base);
	});
});
