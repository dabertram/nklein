import { describe, expect, it } from "vitest";
import { contentLooksSecretLike, labelsForSourceContent } from "../../../src/core/taint-content-scan";

describe("taint content scan (§5.L secret_like source)", () => {
	it("flags secret-shaped content (keys, tokens, private-key blocks, credential assignments)", () => {
		expect(contentLooksSecretLike("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END")).toBe(true);
		expect(contentLooksSecretLike("here is the key: sk-ant-0123456789abcdefghij_more")).toBe(true);
		expect(contentLooksSecretLike("token = 'ghp_0123456789abcdefghijABCDEFGHIJ'")).toBe(true);
		expect(contentLooksSecretLike("AWS: AKIAIOSFODNN7EXAMPLE end")).toBe(true);
		expect(contentLooksSecretLike("password: hunter2hunter2hunter2hunter2extra")).toBe(true);
	});

	it("does NOT flag ordinary prose/code without a secret shape", () => {
		expect(contentLooksSecretLike("The quick brown fox reads the README and writes a slug function.")).toBe(false);
		expect(contentLooksSecretLike("const total = a + b; // sum the two numbers")).toBe(false);
		expect(contentLooksSecretLike("")).toBe(false);
	});

	it("layers secret_like on top of the source provenance label when content reads as a secret", () => {
		const labels = labelsForSourceContent("web", "leaked config: api_key=AbCdEf0123456789AbCdEf0123456789");
		expect(labels).toEqual(["web", "secret_like"]);
	});

	it("carries only the source label when the content is clean", () => {
		expect(labelsForSourceContent("mcp", "a normal tool result with no secrets")).toEqual(["mcp"]);
	});

	it("honors an explicit looksSecretLike override even when the scan finds nothing (OR semantics)", () => {
		const labels = labelsForSourceContent("repo", "totally clean text", { looksSecretLike: true });
		expect(labels).toEqual(["repo_instruction", "secret_like"]);
	});

	it("never double-labels when the source kind is already secret_like-adjacent (order-stable, deduped)", () => {
		// private_repo content that also reads as a secret gets BOTH, in canonical order, once each.
		const labels = labelsForSourceContent("private_repo", "id_rsa: -----BEGIN RSA PRIVATE KEY-----");
		expect(labels).toEqual(["private_repo", "secret_like"]);
	});
});
