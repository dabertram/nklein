import { describe, expect, it } from "vitest";
import {
	createEmptyWorkspaceIndex,
	isNodeErrorWithCode,
	parseWorkspaceIndex,
	parseWorkspaceStateSavePayload,
} from "../../../src/state/workspace-state-io";

describe("createEmptyWorkspaceIndex", () => {
	it("is an empty, versioned index", () => {
		const index = createEmptyWorkspaceIndex();
		expect(index.entries).toEqual({});
		expect(index.repoPathToId).toEqual({});
		expect(typeof index.version).toBe("number");
	});
});

describe("isNodeErrorWithCode", () => {
	it("matches only an object carrying the exact code property", () => {
		expect(isNodeErrorWithCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
		expect(isNodeErrorWithCode({ code: "EACCES" }, "ENOENT")).toBe(false);
		expect(isNodeErrorWithCode(new Error("no code"), "ENOENT")).toBe(false);
		for (const notAnErrorObject of [null, undefined, "ENOENT", 42, {}]) {
			expect(isNodeErrorWithCode(notAnErrorObject, "ENOENT")).toBe(false);
		}
	});
});

describe("parseWorkspaceIndex", () => {
	it("falls back to an empty index for null (missing file) and round-trips a valid index", () => {
		expect(parseWorkspaceIndex(null)).toEqual(createEmptyWorkspaceIndex());
		const valid = createEmptyWorkspaceIndex();
		expect(parseWorkspaceIndex(valid)).toEqual(valid);
	});
});

describe("parseWorkspaceStateSavePayload", () => {
	it("throws (fails loud) on an invalid payload", () => {
		expect(() => parseWorkspaceStateSavePayload({} as never)).toThrow(/Invalid workspace state save payload/);
	});
});
