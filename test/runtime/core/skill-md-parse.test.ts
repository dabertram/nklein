import { describe, expect, it } from "vitest";
import { parseSkillMd } from "../../../src/core/skill-md-parse";

/** Small helper: parse and assert success, returning the success branch narrowed. */
function parseOk(text: string) {
	const result = parseSkillMd(text);
	if (!result.ok) {
		throw new Error(`expected ok, got errors: ${result.errors.map((e) => e.code).join(", ")}`);
	}
	return result;
}

/** Small helper: parse and assert failure, returning the error codes. */
function parseErrCodes(text: unknown): string[] {
	const result = parseSkillMd(text);
	if (result.ok) {
		throw new Error("expected failure but parse succeeded");
	}
	return result.errors.map((e) => e.code);
}

describe("parseSkillMd — happy path", () => {
	it("parses a minimal valid SKILL.md (required fields only) and returns the body", () => {
		const src = [
			"---",
			"name: hello-skill",
			"description: Greets the user.",
			"---",
			"",
			"# Hello",
			"Body text.",
		].join("\n");
		const { manifest, body } = parseOk(src);
		expect(manifest.name).toBe("hello-skill");
		expect(manifest.description).toBe("Greets the user.");
		expect(body).toBe("\n# Hello\nBody text.");
		// Optional fields absent, extra empty.
		expect(manifest.license).toBeUndefined();
		expect(manifest.allowedTools).toBeUndefined();
		expect(manifest.extra).toEqual({});
	});

	it("parses the full standard field set (agentskills.io spec)", () => {
		const src = [
			"---",
			"name: pdf-tools",
			"description: Fills and reads PDF forms.",
			"license: MIT",
			"version: 1.2.3",
			"compatibility: claude-code >=1.0",
			"allowed-tools:",
			"  - read_file",
			"  - list_dir",
			"---",
			"instructions here",
		].join("\n");
		const { manifest } = parseOk(src);
		expect(manifest.license).toBe("MIT");
		expect(manifest.version).toBe("1.2.3");
		expect(manifest.compatibility).toBe("claude-code >=1.0");
		expect(manifest.allowedTools).toEqual(["read_file", "list_dir"]);
	});

	it("de-duplicates and trims allowed-tools while preserving first-seen order", () => {
		const src = [
			"---",
			"name: s",
			"description: d",
			"allowed-tools:",
			"  - '  edit_file  '",
			"  - read_file",
			"  - edit_file",
			"---",
		].join("\n");
		const { manifest } = parseOk(src);
		expect(manifest.allowedTools).toEqual(["edit_file", "read_file"]);
	});

	it("distinguishes an explicitly-empty allowed-tools ([]) from an undeclared one", () => {
		const declaredEmpty = parseOk(["---", "name: s", "description: d", "allowed-tools: []", "---"].join("\n"));
		expect(declaredEmpty.manifest.allowedTools).toEqual([]);
		const undeclared = parseOk(["---", "name: s", "description: d", "---"].join("\n"));
		expect(undeclared.manifest.allowedTools).toBeUndefined();
	});

	it("preserves unknown frontmatter keys verbatim in `extra` (never dropped, never promoted)", () => {
		const src = [
			"---",
			"name: s",
			"description: d",
			"author: someone",
			"stars: 42",
			"metadata:",
			"  origin: community",
			"---",
		].join("\n");
		const { manifest } = parseOk(src);
		expect(manifest.extra).toEqual({ author: "someone", stars: 42, metadata: { origin: "community" } });
		// Standard keys never leak into extra.
		expect(manifest.extra).not.toHaveProperty("name");
		expect(manifest.extra).not.toHaveProperty("description");
	});

	it("trims surrounding whitespace on name/description", () => {
		const src = ["---", "name: '   spaced-name   '", "description: '  padded desc  '", "---"].join("\n");
		const { manifest } = parseOk(src);
		expect(manifest.name).toBe("spaced-name");
		expect(manifest.description).toBe("padded desc");
	});

	it("handles CRLF line endings and a leading UTF-8 BOM", () => {
		const src = `﻿---\r\nname: crlf-skill\r\ndescription: works with CRLF.\r\n---\r\nbody line`;
		const { manifest, body } = parseOk(src);
		expect(manifest.name).toBe("crlf-skill");
		expect(body).toBe("body line");
	});

	it("supports a `----` fence (3+ dashes) and an empty body", () => {
		const { manifest, body } = parseOk(["----", "name: s", "description: d", "----"].join("\n"));
		expect(manifest.name).toBe("s");
		expect(body).toBe("");
	});

	it("keeps `---` occurring inside the body from being mistaken for the fence", () => {
		const src = ["---", "name: s", "description: d", "---", "intro", "---", "a horizontal rule in markdown"].join(
			"\n",
		);
		const { body } = parseOk(src);
		expect(body).toBe("intro\n---\na horizontal rule in markdown");
	});
});

describe("parseSkillMd — structural rejections", () => {
	it("rejects empty / whitespace-only / non-string input", () => {
		expect(parseErrCodes("")).toEqual(["empty_input"]);
		expect(parseErrCodes("   \n\t ")).toEqual(["empty_input"]);
		expect(parseErrCodes(undefined)).toEqual(["empty_input"]);
		expect(parseErrCodes(null)).toEqual(["empty_input"]);
		expect(parseErrCodes(42)).toEqual(["empty_input"]);
	});

	it("rejects a document with no opening frontmatter fence", () => {
		expect(parseErrCodes("# just markdown\nno frontmatter here")).toEqual(["missing_frontmatter"]);
	});

	it("does not treat a `---` that is not on the first line as frontmatter", () => {
		// Leading blank line before the fence → not frontmatter.
		expect(parseErrCodes("\n---\nname: s\ndescription: d\n---")).toEqual(["missing_frontmatter"]);
	});

	it("rejects an unterminated frontmatter block", () => {
		expect(parseErrCodes(["---", "name: s", "description: d"].join("\n"))).toEqual(["unterminated_frontmatter"]);
	});

	it("rejects invalid YAML in the frontmatter", () => {
		const src = ["---", "name: s", "description: [unbalanced", "  bad: : :", "---"].join("\n");
		expect(parseErrCodes(src)).toEqual(["invalid_yaml"]);
	});

	it("rejects frontmatter that parses to a scalar, a list, or null (not a mapping)", () => {
		expect(parseErrCodes(["---", "just a bare string", "---"].join("\n"))).toEqual(["frontmatter_not_mapping"]);
		expect(parseErrCodes(["---", "- a", "- b", "---"].join("\n"))).toEqual(["frontmatter_not_mapping"]);
		// An empty frontmatter block parses to null → not a mapping.
		expect(parseErrCodes(["---", "", "---"].join("\n"))).toEqual(["frontmatter_not_mapping"]);
	});
});

describe("parseSkillMd — field validation", () => {
	it("rejects a missing name and a missing description, reporting BOTH", () => {
		const codes = parseErrCodes(["---", "license: MIT", "---"].join("\n"));
		expect(codes).toEqual(["missing_required_field", "missing_required_field"]);
	});

	it("rejects a non-string name (a number is not coerced)", () => {
		expect(parseErrCodes(["---", "name: 123", "description: d", "---"].join("\n"))).toEqual([
			"missing_required_field",
		]);
	});

	it("rejects a blank (whitespace-only) description", () => {
		expect(parseErrCodes(["---", "name: s", "description: '   '", "---"].join("\n"))).toEqual([
			"missing_required_field",
		]);
	});

	it("rejects allowed-tools that is not a list", () => {
		expect(parseErrCodes(["---", "name: s", "description: d", "allowed-tools: read_file", "---"].join("\n"))).toEqual(
			["invalid_field_shape"],
		);
	});

	it("rejects allowed-tools containing a non-string or blank entry", () => {
		const nonString = ["---", "name: s", "description: d", "allowed-tools:", "  - read_file", "  - 7", "---"].join(
			"\n",
		);
		expect(parseErrCodes(nonString)).toEqual(["invalid_field_shape"]);
		const blank = ["---", "name: s", "description: d", "allowed-tools:", "  - '  '", "---"].join("\n");
		expect(parseErrCodes(blank)).toEqual(["invalid_field_shape"]);
	});

	it("rejects a non-string optional scalar field (license as a number)", () => {
		expect(parseErrCodes(["---", "name: s", "description: d", "license: 42", "---"].join("\n"))).toEqual([
			"invalid_field_shape",
		]);
	});

	it("collects multiple independent field errors together", () => {
		const src = ["---", "description: '  '", "allowed-tools: not-a-list", "version: 5", "---"].join("\n");
		const codes = parseErrCodes(src);
		// missing name, blank description, bad allowed-tools, bad version.
		expect(codes.filter((c) => c === "missing_required_field")).toHaveLength(2);
		expect(codes.filter((c) => c === "invalid_field_shape")).toHaveLength(2);
	});

	it("treats an explicit null optional field as absent, not as a shape error", () => {
		const { manifest } = parseOk(["---", "name: s", "description: d", "license: null", "---"].join("\n"));
		expect(manifest.license).toBeUndefined();
	});
});

describe("parseSkillMd — determinism", () => {
	it("is a pure function: identical input yields deeply-equal output", () => {
		const src = [
			"---",
			"name: repeatable",
			"description: same every time",
			"allowed-tools:",
			"  - a",
			"  - b",
			"---",
			"body",
		].join("\n");
		expect(parseSkillMd(src)).toEqual(parseSkillMd(src));
	});
});
