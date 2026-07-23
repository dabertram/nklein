import { describe, expect, it } from "vitest";
import { detectToolchains, planEnvironmentSetup } from "../../src/core/language-toolchain-detection";

describe("language toolchain detection (F12.84)", () => {
	it("picks the package manager from the LOCKFILE, not just package.json", () => {
		expect(detectToolchains(["package.json"])[0]).toMatchObject({
			buildSystem: "npm",
			// `npm ci` without a lockfile is a deterministic failure, not deterministic installation.
			install: "npm install",
			test: "npm run test",
			typecheck: "npm run typecheck",
			coverage: "NODE_V8_COVERAGE=.nklein-coverage npm run test",
		});
		expect(detectToolchains(["package.json", "package-lock.json"])[0]?.install).toBe("npm ci");
		expect(detectToolchains(["package.json", "pnpm-lock.yaml"])[0]).toMatchObject({
			buildSystem: "pnpm",
			install: "pnpm install --frozen-lockfile",
			test: "pnpm run test",
		});
		expect(detectToolchains(["package.json", "yarn.lock"])[0]?.buildSystem).toBe("yarn");
		expect(detectToolchains(["package.json", "bun.lockb"])[0]?.buildSystem).toBe("bun");
	});

	it("detects rust and go with their cheap type gates and no phantom install step", () => {
		const rust = detectToolchains(["Cargo.toml"])[0];
		expect(rust).toMatchObject({ language: "rust", test: "cargo test", typecheck: "cargo check" });
		// cargo resolves deps during build/test — claiming an install step would invent work.
		expect(rust?.install).toBeNull();

		expect(detectToolchains(["go.mod"])[0]).toMatchObject({
			language: "go",
			install: "go mod download",
			test: "go test ./...",
			typecheck: "go build ./...",
			coverage: "go test -coverprofile=.nklein-coverage.out ./...",
		});
	});

	it("prefers maven over gradle when both manifests exist, and supports kotlin gradle", () => {
		expect(detectToolchains(["pom.xml", "build.gradle"])[0]).toMatchObject({ buildSystem: "maven" });
		expect(detectToolchains(["build.gradle.kts"])[0]).toMatchObject({
			buildSystem: "gradle",
			manifest: "build.gradle.kts",
		});
	});

	it("distinguishes poetry from bare pip and only claims a python type gate when opted in", () => {
		expect(detectToolchains(["pyproject.toml", "poetry.lock"])[0]).toMatchObject({
			buildSystem: "poetry",
			install: expect.stringContaining("poetry install"),
			test: "poetry run pytest",
			typecheck: null,
		});
		expect(detectToolchains(["pyproject.toml"])[0]).toMatchObject({
			buildSystem: "pip",
			install: expect.stringContaining("python3 -m venv .nklein-venv"),
			test: ".nklein-venv/bin/pytest",
		});
		expect(detectToolchains(["requirements.txt"])[0]).toMatchObject({
			install: expect.stringContaining(".nklein-venv/bin/pip install -r requirements.txt"),
			test: ".nklein-venv/bin/pytest",
		});
		expect(detectToolchains(["requirements.txt", "mypy.ini"])[0]?.typecheck).toBe(".nklein-venv/bin/mypy .");
	});

	it("returns SEVERAL toolchains for a polyglot repo, in stable order", () => {
		const languages = detectToolchains(["package.json", "Cargo.toml", "go.mod", "pom.xml", "requirements.txt"]).map(
			(toolchain) => toolchain.language,
		);
		expect(languages).toEqual(["javascript", "rust", "go", "java", "python"]);
	});

	it("returns NOTHING for an unrecognized repo rather than guessing commands", () => {
		expect(detectToolchains(["README.md", "src"])).toEqual([]);
		const plan = planEnvironmentSetup(["README.md"]);
		expect(plan.steps).toEqual([]);
		expect(plan.reason).toContain("not guessed");
	});

	it("renders the setup→install→test contract across toolchains", () => {
		const plan = planEnvironmentSetup(["package.json", "package-lock.json", "Cargo.toml"]);
		expect(plan.steps).toEqual(["npm ci", "npm run test", "cargo test"]);
		expect(plan.installSteps).toEqual(["npm ci"]);
		expect(plan.testSteps).toEqual(["npm run test", "cargo test"]);
		expect(plan.coverageSteps).toHaveLength(2);
		expect(plan.runtimeExecutables).toEqual(["npm", "cargo"]);
		expect(plan.reason).toContain("javascript/npm");
		expect(plan.reason).toContain("rust/cargo");
	});
});
