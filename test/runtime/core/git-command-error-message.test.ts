import { describe, expect, it } from "vitest";
import { getGitCommandErrorMessage } from "../../../src/workspace/git-utils";

describe("getGitCommandErrorMessage", () => {
	it("prefers a non-empty stderr (the useful git diagnostic)", () => {
		expect(getGitCommandErrorMessage({ stderr: "  fatal: not a git repository\n" })).toBe(
			"fatal: not a git repository",
		);
	});

	it("falls back to the Error message when stderr is empty/whitespace or absent", () => {
		expect(getGitCommandErrorMessage(Object.assign(new Error("boom"), { stderr: "   " }))).toBe("boom");
		expect(getGitCommandErrorMessage(new Error("spawn failed"))).toBe("spawn failed");
	});

	it("stringifies a non-Error, non-stderr value", () => {
		expect(getGitCommandErrorMessage("plain string error")).toBe("plain string error");
		expect(getGitCommandErrorMessage(42)).toBe("42");
	});
});
