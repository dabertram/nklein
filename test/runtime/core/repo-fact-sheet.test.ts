import { describe, expect, it } from "vitest";
import { buildRepoFactSheet } from "../../../src/core/repo-fact-sheet";

describe("buildRepoFactSheet (F12.23)", () => {
	it("derives package, commands, entry point, and layout from the manifest", () => {
		const sheet = buildRepoFactSheet({
			packageJsonText: JSON.stringify({
				name: "habit-cli",
				type: "module",
				main: "src/index.ts",
				scripts: { test: "vitest run", build: "tsc", deploy: "true" },
			}),
			topLevelDirs: ["src", "test"],
		});
		expect(sheet.rendered).toContain("Package: habit-cli (ESM)");
		expect(sheet.rendered).toContain("npm run test · npm run build");
		expect(sheet.rendered).not.toContain("deploy");
		expect(sheet.rendered).toContain("Entry point: src/index.ts");
		expect(sheet.rendered).toContain("Top-level layout: src, test");
	});

	it("flags npm workspaces as a monorepo hint", () => {
		const sheet = buildRepoFactSheet({
			packageJsonText: JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
			topLevelDirs: [],
		});
		expect(sheet.rendered).toContain("Monorepo: npm workspaces");
	});

	it("says nothing on malformed or absent manifests — never an empty shell or a guess", () => {
		expect(buildRepoFactSheet({ packageJsonText: "{not json", topLevelDirs: [] }).rendered).toBeNull();
		expect(buildRepoFactSheet({ packageJsonText: null, topLevelDirs: [] }).rendered).toBeNull();
	});

	it("F11.2f: names the stack from proven dependencies and the monorepo tooling from root manifests", () => {
		const sheet = buildRepoFactSheet({
			packageJsonText: JSON.stringify({
				name: "mono",
				scripts: { test: "vitest" },
				devDependencies: { typescript: "^5", vitest: "^4", "@biomejs/biome": "^2" },
				dependencies: { react: "^19" },
			}),
			topLevelDirs: ["apps", "packages"],
			monorepoToolFiles: ["turbo.json", "pnpm-workspace.yaml"],
		});
		const rendered = sheet.rendered ?? "";
		expect(rendered).toContain(
			"Stack (from dependencies): TypeScript · tests: vitest · UI: react · lint/format: biome",
		);
		expect(rendered).toContain("Monorepo tooling: pnpm-workspace.yaml, turbo.json");
		expect(rendered).toContain("ONE package");
		// No proven markers ⇒ no stack line (facts only, never guesses).
		const bare = buildRepoFactSheet({
			packageJsonText: JSON.stringify({ name: "tiny", dependencies: { leftpad: "1" } }),
			topLevelDirs: [],
		});
		expect(bare.rendered ?? "").not.toContain("Stack (from dependencies)");
	});
});
