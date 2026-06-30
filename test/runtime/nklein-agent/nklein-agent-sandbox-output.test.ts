import { describe, expect, it } from "vitest";

import {
	bufferOrStringToString,
	joinDockerOutput,
	parseDockerOutputLines,
} from "../../../src/nklein-agent/nklein-agent-sandbox-output";

describe("bufferOrStringToString", () => {
	it("passes a string through, decodes a Buffer as utf8, and defaults undefined to empty", () => {
		expect(bufferOrStringToString("hello")).toBe("hello");
		expect(bufferOrStringToString(Buffer.from("héllo", "utf8"))).toBe("héllo");
		expect(bufferOrStringToString(undefined)).toBe("");
	});
});

describe("joinDockerOutput", () => {
	it("joins trimmed stderr then stdout, dropping blank parts", () => {
		expect(joinDockerOutput({ stderr: "warn", stdout: "ok" })).toBe("warn\nok");
		expect(joinDockerOutput({ stderr: "", stdout: "ok" })).toBe("ok");
		expect(joinDockerOutput({ stderr: "  ", stdout: "  " })).toBe("");
		expect(joinDockerOutput({ stderr: "  err  ", stdout: "  out  " })).toBe("err\nout");
	});
});

describe("parseDockerOutputLines", () => {
	it("splits into trimmed, non-empty lines (tolerating CRLF)", () => {
		expect(parseDockerOutputLines("a\nb\n\nc")).toEqual(["a", "b", "c"]);
		expect(parseDockerOutputLines("a\r\nb")).toEqual(["a", "b"]);
		expect(parseDockerOutputLines("  x  \n  y  ")).toEqual(["x", "y"]);
		expect(parseDockerOutputLines("")).toEqual([]);
		expect(parseDockerOutputLines("   \n   ")).toEqual([]);
	});
});
