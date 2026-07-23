/**
 * F12.84 per-language environment + test-runner auto-detection — PURE core.
 *
 * Environment construction is the top multi-language bottleneck (EnvBench full-setup <7%; "model size and
 * reasoning length are not decisive"), which means it is a job for DETERMINISTIC detection, not for asking a
 * small model to guess build commands. This maps a repo's manifest files onto a standard
 * `setup → install → test → coverage` contract per toolchain, plus the cheap `typecheck` command where the language
 * has one (feeding F12.86's type-check-first gate beyond npm).
 *
 * Honesty stance: only manifests we actually recognize produce commands. An unrecognized repo yields NO
 * toolchains rather than a plausible-looking guess — a wrong `install` command wastes a sandbox run and teaches
 * the model nothing, which is worse than admitting we cannot tell.
 */

export type ToolchainLanguage = "javascript" | "rust" | "go" | "java" | "python";

export interface Toolchain {
	readonly language: ToolchainLanguage;
	/** The build system that owns the project (npm/pnpm/yarn, cargo, go, maven, gradle, poetry, pip). */
	readonly buildSystem: string;
	/** The manifest that proved it — provenance so a human can check the detection. */
	readonly manifest: string;
	/** Dependency installation command (null when the toolchain needs none). */
	readonly install: string | null;
	readonly test: string;
	/** Coverage runner that stays inside the sandbox; null only when no honest generic runner exists. */
	readonly coverage: string | null;
	/** Cheap correctness gate when the language has one (F12.86); null when it does not. */
	readonly typecheck: string | null;
	/** Executable that proves the selected runtime is actually present in the sandbox image. */
	readonly runtimeExecutable: string;
}

const PYTHON_TEST_TOOLS = "pytest==8.4.1 coverage==7.9.2 mypy==1.16.1";

function has(files: ReadonlySet<string>, name: string): boolean {
	return files.has(name);
}

/**
 * Detect the toolchains present at a repo root from its FILE NAMES (root-level; the caller supplies the listing,
 * so this stays pure and works identically on host and sandbox). A monorepo can legitimately return several.
 * Order is stable: JavaScript, Rust, Go, Java, Python.
 */
export function detectToolchains(rootFileNames: readonly string[]): Toolchain[] {
	const files = new Set(rootFileNames.map((name) => name.trim()).filter(Boolean));
	const toolchains: Toolchain[] = [];

	if (has(files, "package.json")) {
		// Lockfile decides the package manager — a pnpm repo installed with npm silently diverges from CI.
		const buildSystem = has(files, "pnpm-lock.yaml")
			? "pnpm"
			: has(files, "yarn.lock")
				? "yarn"
				: has(files, "bun.lockb")
					? "bun"
					: "npm";
		const runner = buildSystem === "npm" ? "npm run" : `${buildSystem} run`;
		const install =
			buildSystem === "npm"
				? has(files, "package-lock.json") || has(files, "npm-shrinkwrap.json")
					? "npm ci"
					: "npm install"
				: buildSystem === "pnpm"
					? "pnpm install --frozen-lockfile"
					: buildSystem === "yarn"
						? "yarn install --frozen-lockfile"
						: "bun install --frozen-lockfile";
		toolchains.push({
			language: "javascript",
			buildSystem,
			manifest: "package.json",
			install,
			test: `${runner} test`,
			// Node's built-in V8 coverage works independently of Jest/Vitest/Mocha and needs no runtime download.
			coverage: `NODE_V8_COVERAGE=.nklein-coverage ${runner} test`,
			// The SCRIPT is the contract; whether it exists is the caller's package.json read (F11.2g).
			typecheck: `${runner} typecheck`,
			runtimeExecutable: buildSystem,
		});
	}
	if (has(files, "Cargo.toml")) {
		toolchains.push({
			language: "rust",
			buildSystem: "cargo",
			manifest: "Cargo.toml",
			// cargo resolves dependencies as part of build/test — no separate install step exists.
			install: null,
			test: "cargo test",
			coverage:
				"mkdir -p .nklein-coverage && CARGO_INCREMENTAL=0 RUSTFLAGS='-Cinstrument-coverage' LLVM_PROFILE_FILE='.nklein-coverage/%p-%m.profraw' cargo test",
			typecheck: "cargo check",
			runtimeExecutable: "cargo",
		});
	}
	if (has(files, "go.mod")) {
		toolchains.push({
			language: "go",
			buildSystem: "go",
			manifest: "go.mod",
			install: "go mod download",
			test: "go test ./...",
			coverage: "go test -coverprofile=.nklein-coverage.out ./...",
			typecheck: "go build ./...",
			runtimeExecutable: "go",
		});
	}
	if (has(files, "pom.xml")) {
		toolchains.push({
			language: "java",
			buildSystem: "maven",
			manifest: "pom.xml",
			install: "mvn -q -B dependency:go-offline",
			test: "mvn -q -B test",
			coverage: "mvn -q -B test org.jacoco:jacoco-maven-plugin:0.8.13:report",
			typecheck: "mvn -q -B compile",
			runtimeExecutable: "mvn",
		});
	} else if (has(files, "build.gradle") || has(files, "build.gradle.kts")) {
		const manifest = has(files, "build.gradle") ? "build.gradle" : "build.gradle.kts";
		toolchains.push({
			language: "java",
			buildSystem: "gradle",
			manifest,
			install: null,
			test: "gradle test",
			// A Gradle project must opt into the JaCoCo plugin; inventing that mutation here would change the project.
			coverage: null,
			typecheck: "gradle compileJava",
			runtimeExecutable: "gradle",
		});
	}
	if (has(files, "pyproject.toml")) {
		// poetry.lock is the only unambiguous poetry signal; a bare pyproject is PEP-621 + pip.
		const poetry = has(files, "poetry.lock");
		toolchains.push({
			language: "python",
			buildSystem: poetry ? "poetry" : "pip",
			manifest: "pyproject.toml",
			install: poetry
				? `poetry install && poetry run pip install ${PYTHON_TEST_TOOLS}`
				: `python3 -m venv .nklein-venv && .nklein-venv/bin/pip install -e . ${PYTHON_TEST_TOOLS}`,
			test: poetry ? "poetry run pytest" : ".nklein-venv/bin/pytest",
			coverage: poetry
				? "poetry run coverage run -m pytest && poetry run coverage report"
				: ".nklein-venv/bin/coverage run -m pytest && .nklein-venv/bin/coverage report",
			// Python has no universally-present type gate; only claim one when the repo opted in.
			typecheck: has(files, "mypy.ini") ? (poetry ? "poetry run mypy ." : ".nklein-venv/bin/mypy .") : null,
			runtimeExecutable: poetry ? "poetry" : "python3",
		});
	} else if (has(files, "requirements.txt")) {
		toolchains.push({
			language: "python",
			buildSystem: "pip",
			manifest: "requirements.txt",
			install: `python3 -m venv .nklein-venv && .nklein-venv/bin/pip install -r requirements.txt ${PYTHON_TEST_TOOLS}`,
			test: ".nklein-venv/bin/pytest",
			coverage: ".nklein-venv/bin/coverage run -m pytest && .nklein-venv/bin/coverage report",
			typecheck: has(files, "mypy.ini") ? ".nklein-venv/bin/mypy ." : null,
			runtimeExecutable: "python3",
		});
	}
	return toolchains;
}

export interface EnvironmentPlan {
	readonly toolchains: readonly Toolchain[];
	/** Ordered setup→install→test commands across every detected toolchain. */
	readonly steps: readonly string[];
	/** Dependency/setup commands to execute exactly once for a fresh sandbox clone. */
	readonly installSteps: readonly string[];
	readonly testSteps: readonly string[];
	readonly coverageSteps: readonly string[];
	readonly runtimeExecutables: readonly string[];
	readonly reason: string;
}

/**
 * Render the standard setup→install→test contract for the detected toolchains. An empty detection returns NO
 * steps and says why, so a caller never runs invented commands against an unknown repo.
 */
export function planEnvironmentSetup(rootFileNames: readonly string[]): EnvironmentPlan {
	const toolchains = detectToolchains(rootFileNames);
	if (toolchains.length === 0) {
		return {
			toolchains,
			steps: [],
			installSteps: [],
			testSteps: [],
			coverageSteps: [],
			runtimeExecutables: [],
			reason: "no recognized build manifest at the repo root — environment setup cannot be inferred (not guessed)",
		};
	}
	const steps: string[] = [];
	const installSteps: string[] = [];
	const testSteps: string[] = [];
	const coverageSteps: string[] = [];
	for (const toolchain of toolchains) {
		if (toolchain.install) {
			steps.push(toolchain.install);
			installSteps.push(toolchain.install);
		}
		steps.push(toolchain.test);
		testSteps.push(toolchain.test);
		if (toolchain.coverage) coverageSteps.push(toolchain.coverage);
	}
	const names = toolchains.map((toolchain) => `${toolchain.language}/${toolchain.buildSystem}`).join(", ");
	return {
		toolchains,
		steps,
		installSteps,
		testSteps,
		coverageSteps,
		runtimeExecutables: [...new Set(toolchains.map((toolchain) => toolchain.runtimeExecutable))],
		reason: `detected ${toolchains.length} toolchain(s): ${names}`,
	};
}
