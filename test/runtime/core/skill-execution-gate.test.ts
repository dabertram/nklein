import { describe, expect, it } from "vitest";
import type {
	BundledFileEntryReport,
	BundledFileFinding,
	BundledFileFindingCode,
} from "../../../src/core/skill-bundled-file-manifest";
import {
	classifyBundledFileExecution,
	gateSkillBundleExecution,
	neverAutoExecutePaths,
	skillBundleRequiresExecutionApproval,
} from "../../../src/core/skill-execution-gate";

function finding(code: BundledFileFindingCode): BundledFileFinding {
	// severity is not read by the gate; "review" is a valid value for the executable codes used in these tests.
	return { code, severity: "review", message: code };
}

function entry(
	overrides: Partial<BundledFileEntryReport> & Pick<BundledFileEntryReport, "rawPath">,
): BundledFileEntryReport {
	return {
		normalizedPath: overrides.rawPath,
		category: "references",
		findings: [],
		...overrides,
	};
}

describe("classifyBundledFileExecution", () => {
	it("marks a file under scripts/ as approval-required by LOCATION (RCE-by-default), even with no exec finding", () => {
		const d = classifyBundledFileExecution(entry({ rawPath: "scripts/setup", category: "scripts" }));
		expect(d.disposition).toBe("requires-approval");
		expect(d.reasons).toContain("under_scripts_root");
	});

	it("marks an executable-mode file approval-required wherever it lives", () => {
		const d = classifyBundledFileExecution(
			entry({ rawPath: "assets/tool", category: "assets", findings: [finding("executable_mode")] }),
		);
		expect(d.disposition).toBe("requires-approval");
		expect(d.reasons).toContain("executable_bit");
	});

	it("catches a .sh smuggled into assets/ WITHOUT the exec bit (defence-in-depth extension check)", () => {
		const d = classifyBundledFileExecution(
			entry({ rawPath: "assets/innocent.sh", category: "assets", findings: [] }),
		);
		expect(d.disposition).toBe("requires-approval");
		expect(d.reasons).toContain("executable_extension");
	});

	it("honours the manifest's executable_script finding", () => {
		const d = classifyBundledFileExecution(
			entry({ rawPath: "scripts/run.py", category: "scripts", findings: [finding("executable_script")] }),
		);
		expect(d.disposition).toBe("requires-approval");
		// both under_scripts_root and executable_extension apply
		expect(d.reasons).toContain("under_scripts_root");
		expect(d.reasons).toContain("executable_extension");
	});

	it("treats an inert reference/asset as inert (materialise + read as data, never runs)", () => {
		expect(
			classifyBundledFileExecution(entry({ rawPath: "references/guide.md", category: "references" })).disposition,
		).toBe("inert");
		expect(classifyBundledFileExecution(entry({ rawPath: "assets/logo.png", category: "assets" })).disposition).toBe(
			"inert",
		);
	});

	it("blocks a reject-level containment violation (never materialised)", () => {
		const d = classifyBundledFileExecution(
			entry({
				rawPath: "../../etc/passwd",
				category: "invalid",
				normalizedPath: "../../etc/passwd",
				findings: [finding("path_traversal")],
			}),
		);
		expect(d.disposition).toBe("blocked");
		expect(d.reasons).toEqual(["reject_containment"]);
	});

	it("reject containment dominates even when the file is also executable", () => {
		const d = classifyBundledFileExecution(
			entry({
				rawPath: "/abs/evil.sh",
				category: "invalid",
				normalizedPath: "/abs/evil.sh",
				findings: [finding("absolute_path"), finding("executable_script")],
			}),
		);
		expect(d.disposition).toBe("blocked");
	});

	it("does not treat a dotfile with no real extension as executable (e.g. .env)", () => {
		// .env secret handling is the manifest's job; the execution gate must not misread it as an extension.
		const d = classifyBundledFileExecution(entry({ rawPath: "references/.env", category: "references" }));
		expect(d.disposition).toBe("inert");
	});

	it("does not treat an extension inside a directory name as the file extension", () => {
		const d = classifyBundledFileExecution(entry({ rawPath: "assets/py.things/readme", category: "assets" }));
		expect(d.disposition).toBe("inert");
	});

	it("is case-insensitive on the extension", () => {
		expect(classifyBundledFileExecution(entry({ rawPath: "assets/X.EXE", category: "assets" })).disposition).toBe(
			"requires-approval",
		);
	});

	it("degrades safely on a malformed entry (missing findings array, non-string path)", () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		const d = classifyBundledFileExecution({ rawPath: 123, normalizedPath: null, category: "assets" } as any);
		expect(d.disposition).toBe("inert"); // no path, nothing executable ⇒ inert (not a crash)
		expect(d.rawPath).toBe("");
	});
});

describe("gateSkillBundleExecution — bundle posture", () => {
	it("clean when every file is inert", () => {
		const r = gateSkillBundleExecution([
			entry({ rawPath: "references/a.md", category: "references" }),
			entry({ rawPath: "assets/b.png", category: "assets" }),
		]);
		expect(r.posture).toBe("clean");
		expect(r.approvalRequired).toHaveLength(0);
		expect(skillBundleRequiresExecutionApproval(r)).toBe(false);
	});

	it("approval-required when any file is executable", () => {
		const r = gateSkillBundleExecution([
			entry({ rawPath: "references/a.md", category: "references" }),
			entry({ rawPath: "scripts/install.sh", category: "scripts", findings: [finding("executable_script")] }),
		]);
		expect(r.posture).toBe("approval-required");
		expect(r.approvalRequired).toHaveLength(1);
		expect(skillBundleRequiresExecutionApproval(r)).toBe(true);
		expect(neverAutoExecutePaths(r)).toEqual(["scripts/install.sh"]);
	});

	it("blocked when any file violates containment (dominates approval-required)", () => {
		const r = gateSkillBundleExecution([
			entry({ rawPath: "scripts/ok.sh", category: "scripts" }),
			entry({
				rawPath: "../evil",
				category: "invalid",
				normalizedPath: "../evil",
				findings: [finding("path_traversal")],
			}),
		]);
		expect(r.posture).toBe("blocked");
		expect(r.blocked).toHaveLength(1);
	});

	it("preserves input order in entries and reports the executables in approvalRequired", () => {
		const r = gateSkillBundleExecution([
			entry({ rawPath: "scripts/one.sh", category: "scripts" }),
			entry({ rawPath: "references/two.md", category: "references" }),
			entry({ rawPath: "assets/three.bin", category: "assets" }),
		]);
		expect(r.entries.map((e) => e.rawPath)).toEqual(["scripts/one.sh", "references/two.md", "assets/three.bin"]);
		expect(r.approvalRequired.map((e) => e.rawPath)).toEqual(["scripts/one.sh", "assets/three.bin"]);
	});

	it("an empty / non-array bundle is a clean empty bundle (total)", () => {
		expect(gateSkillBundleExecution([]).posture).toBe("clean");
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		expect(gateSkillBundleExecution(null as any).posture).toBe("clean");
	});

	it("neverAutoExecutePaths falls back to rawPath when normalisation failed", () => {
		const r = gateSkillBundleExecution([
			entry({ rawPath: "scripts/x.sh", category: "scripts", normalizedPath: null }),
		]);
		expect(neverAutoExecutePaths(r)).toEqual(["scripts/x.sh"]);
	});
});
