import { describe, expect, it } from "vitest";
import { containsStructuredToolFailure, isEffectiveToolResultError } from "../../../src/core/tool-result-failure";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test at all (2026-08-08).
 *
 * What it does is load-bearing and easy to get subtly wrong: an SDK tool result can report failure INSIDE its
 * payload while omitting the top-level `is_error`, so a caller trusting only the transport flag treats a failed
 * tool call as a success. That is the same green-signal substitution this repo keeps finding — a plausible
 * "no error here" standing in for a fact nobody checked — so the tests below concentrate on the shapes where a
 * failure hides rather than on the obvious ones.
 */
describe("containsStructuredToolFailure", () => {
	it("finds each failure spelling the SDK actually uses", () => {
		// Four different vocabularies for one fact. A checker that knows only `is_error` misses three of them.
		expect(containsStructuredToolFailure({ success: false })).toBe(true);
		expect(containsStructuredToolFailure({ ok: false })).toBe(true);
		expect(containsStructuredToolFailure({ is_error: true })).toBe(true);
		expect(containsStructuredToolFailure({ isError: true })).toBe(true);
	});

	it("does NOT fire on the success spellings, or on unrelated falsy fields", () => {
		// The other direction: a checker that flags everything is as useless as one that flags nothing, and a
		// field that merely happens to be false must not read as a failure.
		expect(containsStructuredToolFailure({ success: true })).toBe(false);
		expect(containsStructuredToolFailure({ ok: true })).toBe(false);
		expect(containsStructuredToolFailure({ is_error: false })).toBe(false);
		expect(containsStructuredToolFailure({ verbose: false, cached: false })).toBe(false);
	});

	it("digs through nesting and arrays — the shape a real envelope arrives in", () => {
		expect(containsStructuredToolFailure({ result: { data: { ok: false } } })).toBe(true);
		expect(containsStructuredToolFailure([{ fine: true }, { success: false }])).toBe(true);
		expect(containsStructuredToolFailure({ items: [{ nested: [{ isError: true }] }] })).toBe(true);
		expect(containsStructuredToolFailure({ result: { data: { ok: true } } })).toBe(false);
	});

	it("parses a failure that arrived as a JSON STRING", () => {
		// The live shape from the sandbox tool envelope: the payload is a string containing JSON, so a structural
		// walk that never parses sees an opaque blob and reports no failure.
		expect(containsStructuredToolFailure('{"ok":false,"error":"Blocked edit_file"}')).toBe(true);
		expect(containsStructuredToolFailure('  [{"success":false}]  ')).toBe(true);
		expect(containsStructuredToolFailure('{"ok":true}')).toBe(false);
	});

	it("treats non-JSON text as no evidence, rather than guessing", () => {
		// Absence of parseable structure is not a failure signal. Reporting one here would flag every prose
		// tool result that happens to mention an error.
		expect(containsStructuredToolFailure("the operation failed")).toBe(false);
		expect(containsStructuredToolFailure("{not valid json")).toBe(false);
		expect(containsStructuredToolFailure("")).toBe(false);
	});

	it("is total on the empty and absent cases", () => {
		expect(containsStructuredToolFailure(null)).toBe(false);
		expect(containsStructuredToolFailure(undefined)).toBe(false);
		expect(containsStructuredToolFailure({})).toBe(false);
		expect(containsStructuredToolFailure([])).toBe(false);
		expect(containsStructuredToolFailure(42)).toBe(false);
	});

	it("stops at the depth limit instead of running away on a self-referential payload", () => {
		// The guard exists so a cyclic or pathologically deep envelope cannot hang a turn. Building the cycle is
		// the only way to show the limit does its job — a deep-but-finite object would pass either way.
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(() => containsStructuredToolFailure(cyclic)).not.toThrow();
		expect(containsStructuredToolFailure(cyclic)).toBe(false);

		// A failure buried BELOW the depth limit is deliberately not found — bounded work beats an unbounded walk.
		let deep: Record<string, unknown> = { ok: false };
		for (let level = 0; level < 12; level += 1) {
			deep = { nested: deep };
		}
		expect(containsStructuredToolFailure(deep)).toBe(false);
	});
});

describe("isEffectiveToolResultError", () => {
	it("reports an error when the TRANSPORT failed, whatever the payload says", () => {
		expect(isEffectiveToolResultError(true, { ok: true })).toBe(true);
		expect(isEffectiveToolResultError(true, null)).toBe(true);
	});

	it("reports an error when only the PAYLOAD failed — the case the transport flag misses", () => {
		// The whole point of the module: a clean transport carrying a failed result.
		expect(isEffectiveToolResultError(false, { ok: false })).toBe(true);
		expect(isEffectiveToolResultError(false, '{"success":false}')).toBe(true);
	});

	it("stays quiet when both are clean", () => {
		expect(isEffectiveToolResultError(false, { ok: true })).toBe(false);
		expect(isEffectiveToolResultError(false, "plain text output")).toBe(false);
	});
});
