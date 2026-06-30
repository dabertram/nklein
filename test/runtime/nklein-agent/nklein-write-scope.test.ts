import { describe, expect, it } from "vitest";
import { normalizeScopePath, normalizeWriteScope } from "../../../src/nklein-agent/nklein-write-scope";

describe("normalizeScopePath", () => {
	it("strips matching surrounding quotes", () => {
		expect(normalizeScopePath('"src/a.ts"', "/ws/proj")).toBe("src/a.ts");
		expect(normalizeScopePath("'src/a.ts'", "/ws/proj")).toBe("src/a.ts");
	});

	it("converts backslashes and collapses duplicate slashes", () => {
		expect(normalizeScopePath("src\\sub\\a.ts", "/ws/proj")).toBe("src/sub/a.ts");
		expect(normalizeScopePath("src//sub///a.ts", "/ws/proj")).toBe("src/sub/a.ts");
	});

	it("strips the host workspace prefix", () => {
		expect(normalizeScopePath("/ws/proj/src/a.ts", "/ws/proj")).toBe("src/a.ts");
		expect(normalizeScopePath("/ws/proj/src/a.ts", "/ws/proj/")).toBe("src/a.ts");
	});

	it("strips the sandbox /workspaces/<taskId>/ prefix when a taskId is given", () => {
		expect(normalizeScopePath("/workspaces/task1/src/a.ts", "/ws/proj", "task1")).toBe("src/a.ts");
		// Without the matching taskId the sandbox prefix is left intact (then leading slash removed).
		expect(normalizeScopePath("/workspaces/task1/src/a.ts", "/ws/proj")).toBe("workspaces/task1/src/a.ts");
	});

	it("removes leading ./ and / and trailing slashes", () => {
		expect(normalizeScopePath("./src/a.ts", "/ws/proj")).toBe("src/a.ts");
		expect(normalizeScopePath("/src/a.ts", "/ws/proj")).toBe("src/a.ts");
		expect(normalizeScopePath("src/dir/", "/ws/proj")).toBe("src/dir");
	});

	it("preserves .. escapes so the caller can reject them", () => {
		expect(normalizeScopePath("../escape.ts", "/ws/proj")).toBe("../escape.ts");
		expect(normalizeScopePath("..", "/ws/proj")).toBe("..");
	});
});

describe("normalizeWriteScope", () => {
	it("builds a set of normalized workspace-relative paths", () => {
		const scope = normalizeWriteScope("/ws/proj", null, ["/ws/proj/src/a.ts", "./src/b.ts"]);
		expect(scope).toEqual(new Set(["src/a.ts", "src/b.ts"]));
	});

	it("drops .. escapes from the allowed scope", () => {
		const scope = normalizeWriteScope("/ws/proj", null, ["src/a.ts", "../escape.ts", ".."]);
		expect(scope).toEqual(new Set(["src/a.ts"]));
	});

	it("returns an empty set for empty or missing filesLikelyTouched", () => {
		expect(normalizeWriteScope("/ws/proj", null, null)).toEqual(new Set());
		expect(normalizeWriteScope("/ws/proj", null, [])).toEqual(new Set());
	});

	it("applies the sandbox prefix strip per the taskId", () => {
		const scope = normalizeWriteScope("/ws/proj", "task1", ["/workspaces/task1/src/a.ts"]);
		expect(scope).toEqual(new Set(["src/a.ts"]));
	});
});
