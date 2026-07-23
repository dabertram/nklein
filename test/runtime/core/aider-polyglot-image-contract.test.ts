import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Aider polyglot grader image contract", () => {
	it("owns a pinned Go image with the in-boundary patching tool", async () => {
		const dockerfile = await readFile(resolve("benchmark-harness/aider-polyglot/go.Dockerfile"), "utf8");
		const buildScript = await readFile(resolve("benchmark-harness/aider-polyglot/build-images.sh"), "utf8");

		expect(dockerfile).toContain(
			"FROM golang@sha256:1699c10032ca2582ec89a24a1312d986a3f094aed3d5c1147b19880afe40e052",
		);
		expect(dockerfile).toContain("apk add --no-cache git=2.47.3-r0");
		expect(buildScript).toContain(
			'docker build --file "$root/go.Dockerfile" --tag nklein/aider-polyglot-go:1.0.0 "$root"',
		);
	});
});
