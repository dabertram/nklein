import { describe, expect, it } from "vitest";
import {
	resolveNKleinGuidanceSkillCommand,
	resolveNKleinGuidanceSkillTopic,
} from "../../../src/nklein-agent/nklein-guidance-skills";

describe("resolveNKleinGuidanceSkillTopic", () => {
	it("routes by keyword in the title/prompt", () => {
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "fix the auth token validation" })).toBe("security");
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "redesign the card dialog component" })).toBe("ui");
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "add a zod schema for the trpc contract" })).toBe("ts");
	});

	it("routes by file path when the text is neutral", () => {
		expect(resolveNKleinGuidanceSkillTopic({ filesLikelyTouched: ["src/security/guard.ts"] })).toBe("security");
		expect(resolveNKleinGuidanceSkillTopic({ filesLikelyTouched: ["web-ui/src/App.tsx"] })).toBe("ui");
		expect(resolveNKleinGuidanceSkillTopic({ filesLikelyTouched: ["src/core/foo.ts"] })).toBe("ts");
	});

	it("prefers security over ui over ts when several match", () => {
		// authorization (security) + dialog (ui) → security wins
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "authorization for the dialog" })).toBe("security");
		// component (ui) + interface (ts) → ui wins
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "the component interface" })).toBe("ui");
	});

	it("returns null when nothing matches", () => {
		expect(resolveNKleinGuidanceSkillTopic({ prompt: "rename the greeting message" })).toBeNull();
		expect(resolveNKleinGuidanceSkillTopic({})).toBeNull();
	});
});

describe("resolveNKleinGuidanceSkillCommand", () => {
	it("maps each topic to its slash command", () => {
		expect(resolveNKleinGuidanceSkillCommand("security")).toBe("nklein-security");
		expect(resolveNKleinGuidanceSkillCommand("ui")).toBe("nklein-ui");
		expect(resolveNKleinGuidanceSkillCommand("ts")).toBe("nklein-ts");
	});
});
