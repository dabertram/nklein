import { describe, expect, it } from "vitest";
import {
	buildSelfBouncePrompt,
	parseSelfBounceVerdict,
	SELF_BOUNCE_PERSONA_ROTATION,
} from "../../../src/core/self-bounce-personas";

describe("buildSelfBouncePrompt (§5.AD self_bounce_varied — distinct lenses, never 'are you sure?')", () => {
	it("rotates through genuinely different personas per round and always carries task + draft", () => {
		const seen = new Set<string>();
		const systems = new Set<string>();
		for (let round = 0; round < 3; round += 1) {
			const prompt = buildSelfBouncePrompt({ task: "Build the widget", draft: "I built it with X.", round });
			seen.add(prompt.persona);
			systems.add(prompt.system);
			expect(prompt.user).toContain("ORIGINAL TASK:\nBuild the widget");
			expect(prompt.user).toContain("DRAFT UNDER REVIEW:\nI built it with X.");
			expect(prompt.system.toLowerCase()).not.toContain("are you sure");
		}
		expect(seen.size).toBe(SELF_BOUNCE_PERSONA_ROTATION.length);
		expect(systems.size).toBe(SELF_BOUNCE_PERSONA_ROTATION.length);
		// Round 3 wraps back to the first persona (deterministic rotation).
		expect(buildSelfBouncePrompt({ task: "t", draft: "d", round: 3 }).persona).toBe(SELF_BOUNCE_PERSONA_ROTATION[0]);
	});

	it("parses the verdict line, failing toward 'revise' on a missing/malformed one", () => {
		expect(parseSelfBounceVerdict("1. Looks right.\nVERDICT: ok")).toBe("ok");
		expect(parseSelfBounceVerdict("1. Edge case fails.\nVERDICT: revise")).toBe("revise");
		expect(parseSelfBounceVerdict("verdict: OK")).toBe("ok");
		expect(parseSelfBounceVerdict("no verdict here")).toBe("revise");
	});
});
