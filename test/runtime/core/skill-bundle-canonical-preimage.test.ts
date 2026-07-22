import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCanonicalSkillBundlePreimage } from "../../../src/core/skill-bundle-canonical-preimage";

const digest = (files: Parameters<typeof buildCanonicalSkillBundlePreimage>[0]): string =>
	createHash("sha256").update(buildCanonicalSkillBundlePreimage(files)).digest("hex");

describe("buildCanonicalSkillBundlePreimage", () => {
	it("is listing-order independent and covers path, mode, and exact bytes", () => {
		const source = { path: "SKILL.md", mode: 0o100644, content: Buffer.from("source") };
		const asset = { path: "assets/a.txt", mode: 0o100600, content: Buffer.from([0, 1, 2]) };
		expect(digest([source, asset])).toBe(digest([asset, source]));
		expect(digest([source, { ...asset, path: "assets/b.txt" }])).not.toBe(digest([source, asset]));
		expect(digest([source, { ...asset, mode: 0o100644 }])).not.toBe(digest([source, asset]));
		expect(digest([source, { ...asset, content: Buffer.from([0, 1, 3]) }])).not.toBe(digest([source, asset]));
	});

	it("uses unambiguous framing and rejects duplicate or non-canonical paths", () => {
		expect(digest([{ path: "assets/a", mode: 0, content: Buffer.from("bc") }])).not.toBe(
			digest([{ path: "assets/ab", mode: 0, content: Buffer.from("c") }]),
		);
		expect(() =>
			buildCanonicalSkillBundlePreimage([
				{ path: "assets/a", mode: 0, content: new Uint8Array() },
				{ path: "assets/a", mode: 0, content: new Uint8Array() },
			]),
		).toThrow("Duplicate");
		expect(() =>
			buildCanonicalSkillBundlePreimage([{ path: "../escape", mode: 0, content: new Uint8Array() }]),
		).toThrow("Non-canonical");
	});
});
