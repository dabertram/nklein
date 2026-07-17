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
});
