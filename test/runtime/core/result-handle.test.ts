import { describe, expect, it } from "vitest";
import { createResultHandleStore, formatResultHandle, parseResultHandle } from "../../../src/core/result-handle";

describe("formatResultHandle", () => {
	it("produces the expected result:// URI", () => {
		expect(formatResultHandle("file-search", "3")).toBe("result://file-search/3");
		expect(formatResultHandle("grep", "1")).toBe("result://grep/1");
	});
});

describe("parseResultHandle", () => {
	it("round-trips a formatted handle", () => {
		const handle = formatResultHandle("file-search", "42");
		expect(parseResultHandle(handle)).toEqual({ tool: "file-search", id: "42" });
	});

	it("tolerates surrounding whitespace", () => {
		expect(parseResultHandle("  result://grep/7  ")).toEqual({ tool: "grep", id: "7" });
	});

	it("returns null for a wrong scheme", () => {
		expect(parseResultHandle("http://tool/1")).toBeNull();
		expect(parseResultHandle("result:/tool/1")).toBeNull();
		expect(parseResultHandle("")).toBeNull();
	});

	it("returns null when the id is missing or empty", () => {
		expect(parseResultHandle("result://tool")).toBeNull();
		expect(parseResultHandle("result://tool/")).toBeNull();
	});

	it("returns null when the tool segment is empty", () => {
		expect(parseResultHandle("result:///1")).toBeNull();
	});

	it("returns null for extra path segments", () => {
		expect(parseResultHandle("result://tool/1/extra")).toBeNull();
	});
});

describe("createResultHandleStore", () => {
	it("put returns a parseable handle with the correct tool name", () => {
		const s = createResultHandleStore();
		const handle = s.put("grep", { lines: ["foo"] });
		const parsed = parseResultHandle(handle);
		expect(parsed).not.toBeNull();
		expect(parsed?.tool).toBe("grep");
	});

	it("get returns the stored value for a known handle", () => {
		const s = createResultHandleStore();
		const value = { hits: 3 };
		const handle = s.put("search", value);
		expect(s.get(handle)).toBe(value);
	});

	it("has reflects presence: true for stored, false for unknown", () => {
		const s = createResultHandleStore();
		const handle = s.put("diff", "big diff output");
		expect(s.has(handle)).toBe(true);
		expect(s.has("result://diff/999")).toBe(false);
	});

	it("get returns undefined for a garbage or unparseable handle", () => {
		const s = createResultHandleStore();
		expect(s.get("not-a-handle")).toBeUndefined();
		expect(s.get("result://tool/")).toBeUndefined();
	});

	it("ids increment monotonically across successive puts", () => {
		const s = createResultHandleStore();
		const h1 = s.put("tool", "a");
		const h2 = s.put("tool", "b");
		const h3 = s.put("tool", "c");
		const ids = [h1, h2, h3].map((h) => Number(parseResultHandle(h)?.id));
		expect(ids[0]).toBeLessThan(ids[1]);
		expect(ids[1]).toBeLessThan(ids[2]);
		// IDs start at 1 and increment by 1.
		expect(ids).toEqual([1, 2, 3]);
	});

	it("each store instance has its own id space", () => {
		const s1 = createResultHandleStore();
		const s2 = createResultHandleStore();
		s1.put("t", "x");
		const s1Second = s1.put("t", "y"); // s1's second handle → id "2"
		const h = s2.put("t", "z");
		// s2's first handle is id "1", regardless of s1's counter.
		expect(parseResultHandle(h)?.id).toBe("1");
		// s2 never stored id "2", so it does not know about s1's second handle.
		expect(s2.has(s1Second)).toBe(false);
		expect(s2.get(s1Second)).toBeUndefined();
	});
});
