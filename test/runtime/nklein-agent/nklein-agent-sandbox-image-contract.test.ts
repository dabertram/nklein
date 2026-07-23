import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent sandbox polyglot image contract (F12.84b)", () => {
	it("pins every copied language runtime by registry digest", async () => {
		const dockerfile = await readFile(resolve("docker/agent-sandbox/Dockerfile"), "utf8");
		for (const image of [
			"rust:1.88-bookworm@sha256:",
			"golang:1.24-bookworm@sha256:",
			"gradle:8.14-jdk21@sha256:",
			"maven:3.9.9-eclipse-temurin-21@sha256:",
		]) {
			expect(dockerfile).toContain(image);
		}
	});

	it("fails the image build when an advertised runtime or package manager is absent", async () => {
		const dockerfile = await readFile(resolve("docker/agent-sandbox/Dockerfile"), "utf8");
		for (const probe of [
			"pnpm --version",
			"yarn --version",
			"bun --version",
			"python3 --version",
			"cargo --version",
			"rustc --version",
			"go version",
			"java -version",
			"gradle --version",
			"mvn --version",
		]) {
			expect(dockerfile).toContain(probe);
		}
	});
});
