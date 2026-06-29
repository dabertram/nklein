import { describe, expect, it } from "vitest";
import { buildFileTree } from "./file-tree";

describe("buildFileTree", () => {
	it("returns an empty array for no paths", () => {
		expect(buildFileTree([])).toEqual([]);
	});

	it("builds a single file node", () => {
		expect(buildFileTree(["a.ts"])).toEqual([{ name: "a.ts", path: "a.ts", type: "file", children: [] }]);
	});

	it("nests directories and sets the leaf as a file, with cumulative paths", () => {
		const tree = buildFileTree(["src/app/main.ts"]);
		expect(tree).toHaveLength(1);
		const src = tree[0];
		expect(src).toMatchObject({ name: "src", path: "src", type: "directory" });
		const app = src?.children[0];
		expect(app).toMatchObject({ name: "app", path: "src/app", type: "directory" });
		expect(app?.children[0]).toMatchObject({ name: "main.ts", path: "src/app/main.ts", type: "file" });
	});

	it("merges files that share a directory", () => {
		const tree = buildFileTree(["src/b.ts", "src/a.ts"]);
		expect(tree).toHaveLength(1);
		expect(tree[0]?.children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]); // sorted within the dir
	});

	it("sorts directories before files, then alphabetically", () => {
		const tree = buildFileTree(["z.ts", "src/x.ts", "a.ts"]);
		expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(["directory:src", "file:a.ts", "file:z.ts"]);
	});

	it("ignores empty path segments (leading/duplicate slashes)", () => {
		const tree = buildFileTree(["/src//a.ts"]);
		expect(tree[0]).toMatchObject({ name: "src", path: "src", type: "directory" });
		expect(tree[0]?.children[0]).toMatchObject({ name: "a.ts", path: "src/a.ts", type: "file" });
	});
});
