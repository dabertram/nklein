import { describe, expect, it } from "vitest";
import { classifySkillSourceTrust, isTrustedSkillSource } from "../../../src/core/skill-source-trust";

describe("classifySkillSourceTrust", () => {
	it("trusts the curated github repos (exact owner/repo), including subpaths + the raw host + odd casing", () => {
		expect(classifySkillSourceTrust("https://github.com/anthropics/skills").trust).toBe("trusted");
		expect(classifySkillSourceTrust("https://github.com/anthropics/skills/tree/main/pdf").trust).toBe("trusted");
		expect(
			classifySkillSourceTrust("https://raw.githubusercontent.com/anthropics/skills/main/pdf/SKILL.md").trust,
		).toBe("trusted");
		expect(classifySkillSourceTrust("https://github.com/tech-leads-club/agent-skills").trust).toBe("trusted");
		expect(classifySkillSourceTrust("https://GitHub.com/Anthropics/Skills.git").trust).toBe("trusted");
	});

	it("trusts the curated host registry (www stripped)", () => {
		expect(classifySkillSourceTrust("https://agentskills.io/skill/foo").trust).toBe("trusted");
		expect(classifySkillSourceTrust("https://www.agentskills.io/x").trust).toBe("trusted");
	});

	it("treats unrecognized github repos as untrusted (a fork or look-alike is not trusted by host)", () => {
		const c = classifySkillSourceTrust("https://github.com/anthropics/skills-evil");
		expect(c.trust).toBe("untrusted");
		expect(c.origin).toBe("github.com/anthropics/skills-evil");
		expect(classifySkillSourceTrust("https://github.com/someone/anthropics-skills").trust).toBe("untrusted");
	});

	it("treats the discovery-only indexes + unknown hosts as untrusted", () => {
		expect(classifySkillSourceTrust("https://skillsmp.com/s/abc").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("https://lobehub.com/x").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("https://skills.sh/x").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("https://random.example.com/skill").trust).toBe("untrusted");
	});

	it("fails safe to untrusted on malformed / non-web sources", () => {
		expect(classifySkillSourceTrust("not a url").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("ftp://github.com/anthropics/skills").trust).toBe("untrusted");
		expect(classifySkillSourceTrust("file:///etc/passwd").trust).toBe("untrusted");
	});

	it("carries a normalized origin + reason for display/provenance", () => {
		const c = classifySkillSourceTrust("https://github.com/anthropics/skills/tree/main");
		expect(c.origin).toBe("github.com/anthropics/skills");
		expect(c.reason).toMatch(/trusted/i);
	});
});

describe("isTrustedSkillSource", () => {
	it("is the boolean convenience over the classifier", () => {
		expect(isTrustedSkillSource("https://github.com/anthropics/skills")).toBe(true);
		expect(isTrustedSkillSource("https://skillsmp.com/s/abc")).toBe(false);
		expect(isTrustedSkillSource("garbage")).toBe(false);
	});
});
