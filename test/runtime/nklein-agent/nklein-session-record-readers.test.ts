import { describe, expect, it } from "vitest";

import {
	readOptionalNumber,
	readOptionalReasoningEffort,
	readOptionalString,
} from "../../../src/nklein-agent/nklein-session-record-readers";

describe("readOptionalString", () => {
	it("distinguishes absent (undefined) / explicit null / valid string", () => {
		expect(readOptionalString({}, "k")).toBeUndefined();
		expect(readOptionalString({ k: null }, "k")).toBeNull();
		expect(readOptionalString({ k: "value" }, "k")).toBe("value");
	});

	it("ignores an out-of-type value as undefined", () => {
		expect(readOptionalString({ k: 5 }, "k")).toBeUndefined();
		expect(readOptionalString({ k: true }, "k")).toBeUndefined();
	});
});

describe("readOptionalNumber", () => {
	it("distinguishes absent / null / valid number, truncating to an integer", () => {
		expect(readOptionalNumber({}, "k")).toBeUndefined();
		expect(readOptionalNumber({ k: null }, "k")).toBeNull();
		expect(readOptionalNumber({ k: 3.7 }, "k")).toBe(3);
		expect(readOptionalNumber({ k: -2.9 }, "k")).toBe(-2);
	});

	it("ignores non-numbers and non-finite values as undefined", () => {
		expect(readOptionalNumber({ k: "5" }, "k")).toBeUndefined();
		expect(readOptionalNumber({ k: Number.NaN }, "k")).toBeUndefined();
		expect(readOptionalNumber({ k: Number.POSITIVE_INFINITY }, "k")).toBeUndefined();
	});
});

describe("readOptionalReasoningEffort", () => {
	it("distinguishes absent / null / a valid effort level", () => {
		expect(readOptionalReasoningEffort({}, "k")).toBeUndefined();
		expect(readOptionalReasoningEffort({ k: null }, "k")).toBeNull();
		expect(readOptionalReasoningEffort({ k: "high" }, "k")).toBe("high");
		expect(readOptionalReasoningEffort({ k: "xhigh" }, "k")).toBe("xhigh");
	});

	it("ignores an unrecognized effort as undefined", () => {
		expect(readOptionalReasoningEffort({ k: "none" }, "k")).toBeUndefined();
		expect(readOptionalReasoningEffort({ k: "bogus" }, "k")).toBeUndefined();
		expect(readOptionalReasoningEffort({ k: 3 }, "k")).toBeUndefined();
	});
});
