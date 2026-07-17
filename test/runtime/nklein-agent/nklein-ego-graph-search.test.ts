import { describe, expect, it } from "vitest";
import { buildSymbolEgoGraph } from "../../../src/core/ego-graph";
import { assembleEgoFileFacts } from "../../../src/nklein-agent/nklein-ego-graph-search";

const FILES = [
	{
		path: "src/util/target.ts",
		content: "export function target(a: number) { return a; }",
	},
	{
		path: "src/caller.ts",
		// TS-style `.js` specifier that resolves to the `.ts` file on disk.
		content: 'import { target } from "./util/target.js";\nexport function caller() { return target(1); }',
	},
	{
		path: "src/dir/deep.ts",
		content: 'import { caller } from "../caller";\nexport const deep = () => caller();',
	},
	{ path: "notes.md", content: "target(1) — not code" },
	{ path: "src/broken.ts", content: "export function ok() { return 1; }" },
];

describe("assembleEgoFileFacts (F11.2c workspace assembly)", () => {
	it("parses TS files, resolves relative imports (extension swaps, ../ hops), and skips non-TS", () => {
		const facts = assembleEgoFileFacts(FILES);
		expect(facts.map((entry) => entry.path)).toEqual([
			"src/util/target.ts",
			"src/caller.ts",
			"src/dir/deep.ts",
			"src/broken.ts",
		]);
		const caller = facts.find((entry) => entry.path === "src/caller.ts");
		expect(caller?.importedPaths).toEqual(["src/util/target.ts"]);
		const deep = facts.find((entry) => entry.path === "src/dir/deep.ts");
		expect(deep?.importedPaths).toEqual(["src/caller.ts"]);
	});

	it("feeds the ego core end-to-end: seed → declaration + user + second-hop user", () => {
		const result = buildSymbolEgoGraph(["target"], assembleEgoFileFacts(FILES), { k: 2 });
		expect(result.targets[0]).toMatchObject({ path: "src/util/target.ts", line: 1, hop: 0 });
		expect(result.targets.some((target) => target.path === "src/caller.ts" && target.hop === 1)).toBe(true);
		expect(result.targets.some((target) => target.path === "src/dir/deep.ts" && target.hop === 2)).toBe(true);
	});

	it("skips bare package specifiers — the neighborhood is the workspace, not node_modules", () => {
		const facts = assembleEgoFileFacts([
			{ path: "src/a.ts", content: 'import ts from "typescript";\nexport const a = 1;' },
		]);
		expect(facts[0]?.importedPaths).toEqual([]);
	});
});
