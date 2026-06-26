import { describe, expect, it } from "vitest";

import { getNKleinToolCallDisplay } from "../../../src/nklein-agent/nklein-tool-call-display";

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

describe("getNKleinToolCallDisplay — decompose_project workflow progress in the input summary", () => {
	// Regression (real evidence): the architect re-called decompose_project as it resolved open clarifying
	// questions one at a time (audio-core open → assumed + webgpu open → both assumed). Summarizing by `slug`
	// alone collapsed all three progress steps to one fingerprint, so the repeated-tool-call guard paused the
	// task at the 3rd call — even though that call had just APPLIED the decomposition (the "paused yet completed"
	// symptom). The summary must reflect the question/task counts so progress steps stay distinct.
	const callsFromEvidence = [
		{ slug: "professional-daw", tasks: [{}], questions: [{ id: "audio-core", status: "open" }] },
		{
			slug: "professional-daw",
			tasks: [{}],
			questions: [
				{ id: "audio-core", status: "assumed-default" },
				{ id: "webgpu-integration", status: "open" },
			],
		},
		{
			slug: "professional-daw",
			tasks: [{}],
			questions: [
				{ id: "audio-core", status: "assumed-default" },
				{ id: "webgpu-integration", status: "assumed-default" },
			],
		},
	];

	it("gives each question-resolution step a distinct summary (no false repeat pause)", () => {
		const summaries = callsFromEvidence.map(
			(input) => getNKleinToolCallDisplay("decompose_project", input).inputSummary,
		);
		expect(summaries[0]).toBe("professional-daw · 1 task · 1 question, 1 open");
		expect(summaries[1]).toBe("professional-daw · 1 task · 2 questions, 1 open");
		expect(summaries[2]).toBe("professional-daw · 1 task · 2 questions");
		expect(new Set(summaries).size).toBe(callsFromEvidence.length);
	});

	it("keeps an identical summary for a genuinely unchanged resubmission (true loop still caught)", () => {
		const input = { slug: "x", tasks: [{}, {}], questions: [{ id: "q", status: "open" }] };
		expect(getNKleinToolCallDisplay("decompose_project", input).inputSummary).toBe(
			getNKleinToolCallDisplay("decompose_project", input).inputSummary,
		);
	});

	it("returns no summary for an argument-less call so the empty-decompose diagnostic still fires", () => {
		expect(getNKleinToolCallDisplay("decompose_project", {}).inputSummary).toBeNull();
	});
});
