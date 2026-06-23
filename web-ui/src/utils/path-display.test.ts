import { describe, expect, it } from "vitest";

import { formatPathForDisplay } from "./path-display";

describe("formatPathForDisplay", () => {
	it("replaces the home prefix with ~", () => {
		expect(formatPathForDisplay("/Users/david/projects/app")).toBe("~/projects/app");
		expect(formatPathForDisplay("/home/dave/code/x")).toBe("~/code/x");
		expect(formatPathForDisplay("/Users/david")).toBe("~");
	});

	it("collapses the macOS/Unix temp dir to $TMPDIR (dev-test + sandbox projects)", () => {
		expect(
			formatPathForDisplay("/private/var/folders/_k/dk3l4h/T/nklein-daw-foundation-platform-1782249304813-F9c1cg"),
		).toBe("$TMPDIR/nklein-daw-foundation-platform-1782249304813-F9c1cg");
		expect(formatPathForDisplay("/var/folders/_k/dk3l4h/T/nklein-x")).toBe("$TMPDIR/nklein-x");
		expect(formatPathForDisplay("/tmp/nklein-verify-project-abc")).toBe("$TMPDIR/nklein-verify-project-abc");
	});

	it("normalizes Windows separators and the home prefix", () => {
		expect(formatPathForDisplay("C:\\Users\\dave\\proj")).toBe("~/proj");
	});

	it("leaves an ordinary absolute path unchanged", () => {
		expect(formatPathForDisplay("/opt/work/repo")).toBe("/opt/work/repo");
	});
});
