import { describe, expect, it } from "vitest";
import { deriveMonorepoTaskScope } from "../../../src/core/monorepo-task-scope";

const PACKAGE_DIRS = ["", "web-ui", "packages/desktop"];
const INSTRUCTION_FILES = ["AGENTS.md", "web-ui/AGENTS.md", "packages/desktop/CLAUDE.md"];

describe("deriveMonorepoTaskScope (F11.2k)", () => {
	it("scopes a single-package card with its governing instruction files, outermost first", () => {
		const scope = deriveMonorepoTaskScope({
			taskFiles: ["web-ui/src/app.tsx", "web-ui/src/board.tsx"],
			packageDirs: PACKAGE_DIRS,
			instructionFiles: INSTRUCTION_FILES,
		});
		expect(scope.packageDir).toBe("web-ui");
		expect(scope.instructionFilePaths).toEqual(["AGENTS.md", "web-ui/AGENTS.md"]);
		expect(scope.note).toContain("Your working package is `web-ui`");
		expect(scope.note).toContain("AGENTS.md, web-ui/AGENTS.md");
	});

	it("flags files that SPAN packages as a scope-creep smell, honestly, without inventing a scope", () => {
		const scope = deriveMonorepoTaskScope({
			taskFiles: ["web-ui/src/app.tsx", "src/core/x.ts"],
			packageDirs: PACKAGE_DIRS,
			instructionFiles: INSTRUCTION_FILES,
		});
		expect(scope.packageDir).toBeNull();
		expect(scope.spansPackages).toEqual(["", "web-ui"]);
		expect(scope.note).toContain("SPAN packages: (root), web-ui");
	});

	it("says nothing for root-scoped cards and empty inputs — the default context needs no note", () => {
		expect(
			deriveMonorepoTaskScope({
				taskFiles: ["src/core/x.ts", "src/server/y.ts"],
				packageDirs: PACKAGE_DIRS,
				instructionFiles: INSTRUCTION_FILES,
			}).note,
		).toBeNull();
		expect(
			deriveMonorepoTaskScope({ taskFiles: [], packageDirs: PACKAGE_DIRS, instructionFiles: [] }).note,
		).toBeNull();
	});

	it("picks the DEEPEST package for nested layouts", () => {
		const scope = deriveMonorepoTaskScope({
			taskFiles: ["packages/desktop/main.ts"],
			packageDirs: ["", "packages", "packages/desktop"],
			instructionFiles: ["packages/desktop/CLAUDE.md"],
		});
		expect(scope.packageDir).toBe("packages/desktop");
		expect(scope.instructionFilePaths).toEqual(["packages/desktop/CLAUDE.md"]);
	});
});
