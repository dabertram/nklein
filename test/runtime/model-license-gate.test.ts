import { describe, expect, it } from "vitest";
import {
	assessModelLicense,
	buildAiBom,
	classifyLicenseFamily,
	type DeploymentContext,
} from "../../src/core/model-license-gate";

const COMMERCIAL: DeploymentContext = { commercial: true, redistributing: false };

describe("model license gate (F12.100)", () => {
	it("classifies the license families", () => {
		expect(classifyLicenseFamily("apache-2.0")).toBe("permissive");
		expect(classifyLicenseFamily("MIT")).toBe("permissive");
		expect(classifyLicenseFamily("llama3.1")).toBe("open_weights_restricted");
		expect(classifyLicenseFamily("cc-by-nc-4.0")).toBe("non_commercial");
		expect(classifyLicenseFamily("AGPL-3.0")).toBe("copyleft");
		expect(classifyLicenseFamily("proprietary")).toBe("proprietary");
	});

	it("treats an absent license as UNKNOWN and warns — never silently permissive", () => {
		expect(classifyLicenseFamily(null)).toBe("unknown");
		const assessment = assessModelLicense({ modelKey: "mystery-7b", license: null }, COMMERCIAL);
		expect(assessment.verdict).toBe("warn");
		expect(assessment.concerns[0]).toContain("UNVETTED");
	});

	it("allows a permissive model cleanly", () => {
		const assessment = assessModelLicense({ modelKey: "qwen-coder", license: "apache-2.0" }, COMMERCIAL);
		expect(assessment.verdict).toBe("allow");
		expect(assessment.concerns).toEqual([]);
		expect(assessment.reason).toContain("clean for this deployment");
	});

	it("REFUSES commercial use of a non-commercial model, but only warns for non-commercial deployments", () => {
		const facts = { modelKey: "research-13b", license: "cc-by-nc-4.0" };
		expect(assessModelLicense(facts, COMMERCIAL).verdict).toBe("refuse");
		expect(assessModelLicense(facts, { commercial: false, redistributing: false }).verdict).toBe("warn");
	});

	it("applies the Llama-family traps: MAU ceiling refuses, EU multimodal warns", () => {
		const facts = { modelKey: "meta-llama-3.1-8b", license: "llama3.1" };
		const huge = assessModelLicense(facts, { ...COMMERCIAL, monthlyActiveUsers: 800_000_000 });
		expect(huge.verdict).toBe("refuse");
		expect(huge.concerns.join(" ")).toContain("700,000,000");
		const eu = assessModelLicense(facts, { ...COMMERCIAL, euDeployment: true });
		expect(eu.verdict).toBe("warn");
		expect(eu.concerns.join(" ")).toContain("EU");
		expect(assessModelLicense(facts, { ...COMMERCIAL, monthlyActiveUsers: 1000 }).verdict).toBe("allow");
	});

	it("refuses redistributing proprietary weights", () => {
		const assessment = assessModelLicense(
			{ modelKey: "vendor-x", license: "proprietary" },
			{ commercial: true, redistributing: true },
		);
		expect(assessment.verdict).toBe("refuse");
	});

	it("renders an AI-BOM that shows gaps honestly and flags project-level refusal", () => {
		const bom = buildAiBom(
			[
				{ modelKey: "qwen-coder", license: "apache-2.0", version: "2.5", hash: "sha256:abc" },
				{ modelKey: "mystery-7b", license: null },
				{ modelKey: "research-13b", license: "cc-by-nc-4.0" },
			],
			COMMERCIAL,
		);
		expect(bom.hasRefusal).toBe(true);
		expect(bom.markdown).toContain("| qwen-coder | 2.5 | apache-2.0 | permissive | sha256:abc | allow |");
		// Unknown fields render as "unknown" rather than being hidden.
		expect(bom.markdown).toContain("| mystery-7b | unknown | unknown | unknown | unknown | warn |");
		expect(bom.markdown).toContain("not legal advice");
		expect(bom.markdown).toContain("`unknown` means unverified, not permissive");
	});
});
