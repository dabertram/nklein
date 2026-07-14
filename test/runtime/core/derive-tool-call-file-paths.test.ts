import { describe, expect, it } from "vitest";
import { deriveToolCallFilePaths } from "../../../src/nklein-agent/nklein-ledger-tool-calls.js";

describe("deriveToolCallFilePaths", () => {
	it("extracts single + array path keys, dedupes, ignores non-file tools", () => {
		expect(deriveToolCallFilePaths({ path: "src/a.ts" })).toEqual(["src/a.ts"]);
		expect(deriveToolCallFilePaths({ file_path: "  x.ts  " })).toEqual(["x.ts"]);
		expect(deriveToolCallFilePaths({ files: ["a.ts", "b.ts", "a.ts"] })).toEqual(["a.ts", "b.ts"]);
		expect(deriveToolCallFilePaths({ command: "ls" })).toEqual([]);
		expect(deriveToolCallFilePaths(null)).toEqual([]);
		expect(deriveToolCallFilePaths("nope")).toEqual([]);
	});
});
