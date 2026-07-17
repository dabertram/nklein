import { describe, expect, it } from "vitest";
import { deriveRepoVerifyCommands } from "../../../src/core/repo-verify-commands";

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ name: "x", scripts });

describe("deriveRepoVerifyCommands (F11.2g)", () => {
	it("derives non-mutating verify scripts in priority order, capped at 2", () => {
		const derivation = deriveRepoVerifyCommands({
			packageJsonContent: pkg({
				typecheck: "tsc --noEmit",
				lint: "biome check .",
				check: "biome ci .",
				test: "vitest",
			}),
			acceptanceCommand: "npm test",
		});
		expect(derivation.commands).toEqual([
			{ script: "lint", command: "npm run lint" },
			{ script: "typecheck", command: "npm run typecheck" },
		]);
	});

	it("skips mutating scripts and acceptance-covered scripts, with reasons", () => {
		const derivation = deriveRepoVerifyCommands({
			packageJsonContent: pkg({ lint: "biome check --write .", typecheck: "tsc --noEmit" }),
			acceptanceCommand: "npm run typecheck && npm test",
		});
		expect(derivation.commands).toEqual([]);
		expect(derivation.skippedScripts).toEqual([
			{ script: "lint", reason: "mutating (would rewrite the tree, not verify it)" },
			{ script: "typecheck", reason: "already covered by the acceptance command" },
		]);
	});

	it("degrades to no checks on missing/unparseable package.json — honestly", () => {
		expect(deriveRepoVerifyCommands({ packageJsonContent: null, acceptanceCommand: null }).commands).toEqual([]);
		const broken = deriveRepoVerifyCommands({ packageJsonContent: "{ nope", acceptanceCommand: null });
		expect(broken.commands).toEqual([]);
		expect(broken.skippedScripts[0]?.reason).toContain("did not parse");
	});
});
