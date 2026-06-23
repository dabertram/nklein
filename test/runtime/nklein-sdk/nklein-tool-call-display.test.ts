import { describe, expect, it } from "vitest";

import { getNKleinToolCallDisplay } from "../../../src/nklein-sdk/nklein-tool-call-display";

describe("getNKleinToolCallDisplay — read_large_file cursor in the input summary", () => {
	// Regression: the repeated-tool-call guard fingerprints on `toolName + "\n" + inputSummary` and samples
	// `tool_call_start` (no `output` yet). Before this fix the summary was the path only, so the legitimate
	// workflow progression start → read → stitch collapsed to one fingerprint and the task was falsely paused as
	// "3 repeated read_large_file tool calls with the same input". The cursor must be part of the summary.
	const cursors = ["start", "read:789:2", "stitch:788/789:1"];

	it("includes the cursor so advancing calls have distinct summaries (no false repeat)", () => {
		const summaries = cursors.map(
			(cursor) => getNKleinToolCallDisplay("read_large_file", { path: "specification.md", cursor }).inputSummary,
		);
		for (const [index, summary] of summaries.entries()) {
			expect(summary).toContain("specification.md");
			expect(summary).toContain(cursors[index] ?? "");
		}
		// All three progressing calls must produce distinct fingerprints.
		expect(new Set(summaries).size).toBe(cursors.length);
	});

	it("keeps an identical summary when the SAME cursor is replayed (true stall still caught)", () => {
		const first = getNKleinToolCallDisplay("read_large_file", { path: "spec.md", cursor: "read:789:2" }).inputSummary;
		const replay = getNKleinToolCallDisplay("read_large_file", {
			path: "spec.md",
			cursor: "read:789:2",
		}).inputSummary;
		expect(replay).toBe(first);
	});

	it("summarizes the first call (cursor 'start', no output yet) with the cursor", () => {
		const display = getNKleinToolCallDisplay("read_large_file", { path: "specification.md", cursor: "start" });
		expect(display.toolName).toBe("read_large_file");
		expect(display.inputSummary).toBe("specification.md @start");
	});

	it("shows the covered line range once the result is available", () => {
		const display = getNKleinToolCallDisplay(
			"read_large_file",
			{ path: "specification.md", cursor: "start" },
			{ startLine: 1, endLine: 788, totalLines: 1277 },
		);
		expect(display.inputSummary).toBe("specification.md:1-788");
	});
});
