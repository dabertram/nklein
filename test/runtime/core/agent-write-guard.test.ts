import { describe, expect, it } from "vitest";
import {
	buildProtectedTestApprovalRequest,
	countTextLines,
	DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
	findPotentialSecretInText,
	findProtectedTestPath,
	formatProtectedTestBlockReason,
	normalizeMaxAgentWritableFileLines,
} from "../../../src/core/agent-write-guard";

describe("normalizeMaxAgentWritableFileLines", () => {
	it("truncates a valid positive number", () => {
		expect(normalizeMaxAgentWritableFileLines(500.7)).toBe(500);
		expect(normalizeMaxAgentWritableFileLines(1)).toBe(1);
		expect(normalizeMaxAgentWritableFileLines(2000)).toBe(2000);
	});

	it("falls back to the default for < 1, non-finite, or non-number input", () => {
		for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null, undefined, {}, []]) {
			expect(normalizeMaxAgentWritableFileLines(bad)).toBe(DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES);
		}
	});
});

describe("countTextLines", () => {
	it("returns 0 for empty text and counts newline-delimited lines otherwise", () => {
		expect(countTextLines("")).toBe(0);
		expect(countTextLines("one line")).toBe(1);
		expect(countTextLines("a\nb")).toBe(2);
		expect(countTextLines("a\nb\n")).toBe(3); // a trailing newline yields a final empty segment
		expect(countTextLines("\n")).toBe(2);
	});
});

describe("findProtectedTestPath", () => {
	it("matches files under the protected prefix and the exact prefix dir", () => {
		expect(findProtectedTestPath("test/protected/foo.test.ts")).toBe("test/protected/foo.test.ts");
		expect(findProtectedTestPath("test/protected")).toBe("test/protected");
		expect(findProtectedTestPath("test/protected/")).toBe("test/protected/");
	});

	it("matches the named protected config file", () => {
		expect(findProtectedTestPath("vitest.protected.config.ts")).toBe("vitest.protected.config.ts");
	});

	it("normalizes leading ./ and backslash separators before matching", () => {
		expect(findProtectedTestPath("./test/protected/foo.ts")).toBe("test/protected/foo.ts");
		expect(findProtectedTestPath("test\\protected\\foo.ts")).toBe("test/protected/foo.ts");
	});

	it("does NOT match unrelated paths or a lookalike prefix", () => {
		expect(findProtectedTestPath("src/foo.ts")).toBeNull();
		expect(findProtectedTestPath("test/protectedish/foo.ts")).toBeNull(); // not the protected dir
		expect(findProtectedTestPath("")).toBeNull();
		expect(findProtectedTestPath("   ")).toBeNull();
	});
});

describe("buildProtectedTestApprovalRequest", () => {
	it("uses provided fields and always names the path + tool in the intent", () => {
		const req = buildProtectedTestApprovalRequest({
			toolName: "edit_file",
			path: "test/protected/guard.test.ts",
			diff: "- a\n+ b",
			reason: "fixing a flake",
			expectedEffects: "no behavior change",
		});
		expect(req.intent).toContain("test/protected/guard.test.ts");
		expect(req.intent).toContain("edit_file");
		expect(req.diff).toBe("- a\n+ b");
		expect(req.reason).toBe("fixing a flake");
		expect(req.expectedEffects).toBe("no behavior change");
	});

	it("supplies safe deny-by-default text when fields are missing or blank", () => {
		const req = buildProtectedTestApprovalRequest({
			toolName: "write_file",
			path: "test/protected/x.ts",
			diff: "  ",
		});
		expect(req.diff).toBe("(diff unavailable from tool input)");
		expect(req.reason.toLowerCase()).toContain("deny");
		expect(req.expectedEffects.toLowerCase()).toContain("guardrail");
	});

	it("truncates an over-long field and marks it", () => {
		const req = buildProtectedTestApprovalRequest({
			toolName: "edit_file",
			path: "test/protected/x.ts",
			diff: "x".repeat(5000),
		});
		expect(req.diff.length).toBeLessThan(5000);
		expect(req.diff).toContain("[truncated]");
	});
});

describe("formatProtectedTestBlockReason", () => {
	it("explains the block and embeds a parseable approval payload", () => {
		const reason = formatProtectedTestBlockReason({ toolName: "edit_file", path: "test/protected/x.ts" });
		expect(reason).toContain("Blocked edit_file: test/protected/x.ts");
		expect(reason).toContain("protected test suite");
		const json = reason.slice(reason.indexOf("{"));
		expect(() => JSON.parse(json)).not.toThrow();
		expect(JSON.parse(json).intent).toContain("test/protected/x.ts");
	});
});

describe("findPotentialSecretInText", () => {
	it("flags a private key block", () => {
		expect(findPotentialSecretInText("-----BEGIN RSA PRIVATE KEY-----")?.label).toBe("private key block");
		expect(findPotentialSecretInText("-----BEGIN PRIVATE KEY-----")?.label).toBe("private key block");
	});

	it("flags vendor API keys with the right label (first matching pattern wins)", () => {
		expect(findPotentialSecretInText("token = sk-ant-api03-abcdefghij1234567890XYZ")?.label).toBe(
			"Anthropic API key",
		);
		expect(findPotentialSecretInText("sk-proj-abcdefghij1234567890ABCDXYZ")?.label).toBe("OpenAI-style API key");
		expect(findPotentialSecretInText("ghp_abcdefghij1234567890ABCDqrst")?.label).toBe("GitHub token");
		expect(findPotentialSecretInText("AKIAIOSFODNN7EXAMPLE")?.label).toBe("AWS access key id");
	});

	it("flags a long credential assignment", () => {
		expect(findPotentialSecretInText('password = "supersecretvalue123456789012"')?.label).toBe(
			"long credential assignment",
		);
		expect(findPotentialSecretInText("API_KEY: aaaaaaaaaaaaaaaaaaaaaaaaaaaa")?.label).toBe(
			"long credential assignment",
		);
	});

	it("returns null for ordinary text with no secret shape", () => {
		expect(findPotentialSecretInText("const greeting = 'hello world';")).toBeNull();
		expect(findPotentialSecretInText("a short token = abc")).toBeNull(); // too short to be a credential
		expect(findPotentialSecretInText("")).toBeNull();
	});
});
