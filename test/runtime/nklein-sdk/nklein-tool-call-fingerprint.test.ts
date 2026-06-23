import { describe, expect, it } from "vitest";
import { computeNKleinToolInputFingerprint } from "../../../src/nklein-sdk/nklein-tool-call-fingerprint";

describe("computeNKleinToolInputFingerprint (todo §5.O — repeated-tool-call guard hardening)", () => {
	it("returns null for empty/argument-less payloads so empty-call counting + diagnostics still apply", () => {
		expect(computeNKleinToolInputFingerprint(undefined)).toBeNull();
		expect(computeNKleinToolInputFingerprint(null)).toBeNull();
		expect(computeNKleinToolInputFingerprint({})).toBeNull();
		expect(computeNKleinToolInputFingerprint([])).toBeNull();
		expect(computeNKleinToolInputFingerprint("")).toBeNull();
		expect(computeNKleinToolInputFingerprint("   ")).toBeNull();
		expect(computeNKleinToolInputFingerprint("{}")).toBeNull();
		expect(computeNKleinToolInputFingerprint("null")).toBeNull();
	});

	it("gives identical fingerprints for identical input (true stall is still caught)", () => {
		const a = computeNKleinToolInputFingerprint({ path: "a.ts", start: 1 });
		const b = computeNKleinToolInputFingerprint({ path: "a.ts", start: 1 });
		expect(a).not.toBeNull();
		expect(a).toBe(b);
	});

	it("is independent of object key order (key churn is not 'progress')", () => {
		expect(computeNKleinToolInputFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
			computeNKleinToolInputFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
		);
	});

	it("treats a stringified JSON payload the same as the structured form (weak models stringify args)", () => {
		const structured = computeNKleinToolInputFingerprint({ slug: "x", tasks: [{ id: "t1" }] });
		const stringified = computeNKleinToolInputFingerprint('{"slug":"x","tasks":[{"id":"t1"}]}');
		expect(structured).not.toBeNull();
		expect(structured).toBe(stringified);
	});

	it("distinguishes ANY difference in the FULL input — not just the first field (the core guarantee)", () => {
		// A lossy summary that only kept `slug` would collapse all of these; the full-input fingerprint must not.
		const base = { slug: "daw", tasks: [{ id: "t1" }], questions: [{ id: "q1", status: "open" }] };
		const differByDeepStatus = {
			slug: "daw",
			tasks: [{ id: "t1" }],
			questions: [{ id: "q1", status: "assumed-default" }],
		};
		const differByAddedQuestion = {
			slug: "daw",
			tasks: [{ id: "t1" }],
			questions: [
				{ id: "q1", status: "open" },
				{ id: "q2", status: "open" },
			],
		};
		const differByTask = {
			slug: "daw",
			tasks: [{ id: "t1" }, { id: "t2" }],
			questions: [{ id: "q1", status: "open" }],
		};
		const fingerprints = [base, differByDeepStatus, differByAddedQuestion, differByTask].map((input) =>
			computeNKleinToolInputFingerprint(input),
		);
		expect(new Set(fingerprints).size).toBe(4);
	});

	it("keeps the read_large_file cursor progression distinct (regression)", () => {
		const cursors = ["start", "read:789:2", "stitch:788/789:1"];
		const fingerprints = cursors.map((cursor) =>
			computeNKleinToolInputFingerprint({ path: "specification.md", cursor }),
		);
		expect(new Set(fingerprints).size).toBe(cursors.length);
	});

	it("keeps the decompose_project question-resolution progression distinct (regression)", () => {
		const calls = [
			{ slug: "daw", questions: [{ id: "audio", status: "open" }] },
			{
				slug: "daw",
				questions: [
					{ id: "audio", status: "assumed-default" },
					{ id: "webgpu", status: "open" },
				],
			},
			{
				slug: "daw",
				questions: [
					{ id: "audio", status: "assumed-default" },
					{ id: "webgpu", status: "assumed-default" },
				],
			},
		];
		const fingerprints = calls.map((input) => computeNKleinToolInputFingerprint(input));
		expect(new Set(fingerprints).size).toBe(calls.length);
	});

	it("falls back to a stable string fingerprint for non-JSON string input", () => {
		expect(computeNKleinToolInputFingerprint("hello")).toBe(computeNKleinToolInputFingerprint("hello"));
		expect(computeNKleinToolInputFingerprint("hello")).not.toBe(computeNKleinToolInputFingerprint("world"));
	});
});
