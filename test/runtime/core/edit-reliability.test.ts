import { describe, expect, it } from "vitest";
import { runDevEditReliabilityCommand } from "../../../src/commands/dev-edit-reliability-command";
import {
	computeEditReliability,
	DEFAULT_EDIT_TOOL_NAMES,
	type EditReliabilityAttempt,
	MIN_EDIT_CALLS_FOR_RATE,
} from "../../../src/core/edit-reliability";

/**
 * P21.1 step 1 — per-model edit reliability.
 *
 * The load-bearing cases are the two ways this metric could lie: counting an UNRECORDED outcome as a success, and
 * reporting a confident rate from a handful of calls. Both would produce a number that looks like evidence and
 * would be used to route models.
 */

function attempt(modelId: string, calls: readonly [string, string | null][]): EditReliabilityAttempt {
	return { modelId, toolCalls: calls.map(([name, outcome]) => ({ name, outcome })) };
}

/** N edit calls with the given outcome, enough to clear the floor unless told otherwise. */
function calls(name: string, outcome: string | null, count: number): [string, string | null][] {
	return Array.from({ length: count }, () => [name, outcome] as [string, string | null]);
}

describe("computeEditReliability", () => {
	it("computes a per-model success rate over edit-class tools", () => {
		const report = computeEditReliability({
			attempts: [attempt("lm:weak:1234", [...calls("edit_file", "success", 6), ...calls("edit_file", "error", 14)])],
		});
		expect(report.ranked).toHaveLength(1);
		expect(report.ranked[0]?.reliability).toBeCloseTo(0.3, 6);
		expect(report.ranked[0]?.classifiedCalls).toBe(20);
	});

	it("IGNORES non-edit tools, so a chatty reader does not dilute the rate", () => {
		const report = computeEditReliability({
			attempts: [
				attempt("lm:m:1", [
					...calls("edit_file", "error", 20),
					...calls("read_files", "success", 500),
					...calls("run_commands", "success", 100),
				]),
			],
		});
		expect(report.ranked[0]?.classifiedCalls).toBe(20);
		expect(report.ranked[0]?.reliability).toBe(0);
	});

	it("does NOT count an unrecorded outcome as a success — the lie that would read as excellence", () => {
		// `outcome` is nullable and absent on legacy lines. `outcome !== "error"` would report 100% here for a
		// model whose data simply predates the field.
		const report = computeEditReliability({
			attempts: [attempt("lm:legacy:1", [...calls("edit_file", null, 40), ...calls("edit_file", "error", 20)])],
		});
		const row = report.ranked[0];
		expect(row?.unknownOutcome).toBe(40);
		expect(row?.classifiedCalls).toBe(20);
		expect(row?.reliability, "only the 20 classified calls count, and all failed").toBe(0);
	});

	it("treats an UNRECOGNISED outcome string as unknown, not as success", () => {
		const report = computeEditReliability({
			attempts: [attempt("lm:m:1", [...calls("edit_file", "cancelled", 30), ...calls("edit_file", "success", 20)])],
		});
		expect(report.ranked[0]?.unknownOutcome).toBe(30);
		expect(report.ranked[0]?.classifiedCalls).toBe(20);
	});

	it("reports insufficient_data with a NULL rate below the floor", () => {
		// A confident-looking fraction from three calls is exactly the guess this refuses to make.
		const report = computeEditReliability({
			attempts: [attempt("lm:sparse:1", [...calls("edit_file", "error", 3)])],
		});
		expect(report.ranked).toEqual([]);
		expect(report.unmeasured[0]?.verdict).toBe("insufficient_data");
		expect(report.unmeasured[0]?.reliability).toBeNull();
	});

	it("keeps unmeasured models OUT of the ranking, so no-data is never read as no-problem", () => {
		const report = computeEditReliability({
			attempts: [
				attempt("lm:measured:1", [...calls("edit_file", "success", 20)]),
				attempt("lm:sparse:1", [...calls("edit_file", "error", 2)]),
			],
		});
		expect(report.ranked.map((row) => row.modelId)).toEqual(["lm:measured:1"]);
		expect(report.unmeasured.map((row) => row.modelId)).toEqual(["lm:sparse:1"]);
	});

	it("ranks WORST FIRST — the order the routing half would walk", () => {
		const report = computeEditReliability({
			attempts: [
				attempt("lm:good:1", [...calls("editor", "success", 18), ...calls("editor", "error", 2)]),
				attempt("lm:bad:1", [...calls("editor", "success", 4), ...calls("editor", "error", 16)]),
				attempt("lm:mid:1", [...calls("editor", "success", 12), ...calls("editor", "error", 8)]),
			],
		});
		expect(report.ranked.map((row) => row.modelId)).toEqual(["lm:bad:1", "lm:mid:1", "lm:good:1"]);
	});

	it("is deterministic when two models tie", () => {
		const build = () =>
			computeEditReliability({
				attempts: [
					attempt("lm:b:1", [...calls("editor", "success", 10), ...calls("editor", "error", 10)]),
					attempt("lm:a:1", [...calls("editor", "success", 10), ...calls("editor", "error", 10)]),
				],
			}).ranked.map((row) => row.modelId);
		expect(build()).toEqual(["lm:a:1", "lm:b:1"]);
		expect(build()).toEqual(build());
	});

	it("aggregates a model across MANY attempts, not per attempt", () => {
		const report = computeEditReliability({
			attempts: Array.from({ length: 20 }, () => attempt("lm:m:1", [["edit_file", "success"]])),
		});
		expect(report.ranked[0]?.classifiedCalls).toBe(20);
	});

	it("honours a custom tool list, because tool names drift", () => {
		const report = computeEditReliability({
			attempts: [attempt("lm:m:1", [...calls("patch_thing", "error", 20)])],
			editToolNames: ["patch_thing"],
		});
		expect(report.ranked[0]?.reliability).toBe(0);
	});

	it("says plainly that an empty ranking is not evidence of reliability", () => {
		const report = computeEditReliability({ attempts: [] });
		expect(report.ranked).toEqual([]);
		expect(report.summary).toMatch(/NOT evidence that editing is reliable/u);
	});

	it("states the metric's limit in its own summary", () => {
		// The claim this must never be mistaken for is Aider's edit-FORMAT correctness. Anyone reading the output
		// sees the caveat without opening the source.
		const report = computeEditReliability({
			attempts: [attempt("lm:m:1", [...calls("edit_file", "success", 20)])],
		});
		expect(report.summary).toMatch(/not 'struggles with DIFF FORMAT'/u);
	});

	it("covers the edit tools actually registered today", () => {
		// A stale list silently measures nothing: every edit call would be skipped and every model would look
		// unmeasured, which reads as "no data yet" rather than "the list is wrong".
		expect(DEFAULT_EDIT_TOOL_NAMES).toEqual(["apply_patch", "edit_file", "editor", "write_file", "write_files"]);
		expect(MIN_EDIT_CALLS_FOR_RATE).toBeGreaterThan(1);
	});
});

/**
 * The `dev edit-reliability` WIRE — the ledger read is injected, so no real ledger is touched.
 */
describe("dev edit-reliability", () => {
	async function run(events: unknown[], options: { json?: boolean } = {}): Promise<string> {
		const originalWrite = process.stdout.write.bind(process.stdout);
		let out = "";
		process.stdout.write = ((chunk: string) => {
			out += chunk;
			return true;
		}) as typeof process.stdout.write;
		try {
			await runDevEditReliabilityCommand({
				...options,
				readLedger: async () => events as never,
			});
			return out;
		} finally {
			process.stdout.write = originalWrite;
		}
	}

	const attemptEvent = (modelId: string, calls: readonly [string, string | null][]) => ({
		kind: "attempt",
		modelId,
		toolCalls: calls.map(([name, outcome]) => ({ name, outcome })),
	});

	it("reads ONLY attempt events, ignoring the rest of the ledger", async () => {
		const out = await run([
			{ kind: "transition", modelId: "ignored" },
			{ kind: "scheduler" },
			attemptEvent("lm:m:1", calls("edit_file", "success", 20)),
		]);
		expect(out).toContain("1 attempt event(s) read.");
		expect(out).toContain("lm:m:1");
	});

	it("prints unmeasured models too, so the measured list is not mistaken for the whole fleet", async () => {
		const out = await run([
			attemptEvent("lm:measured:1", calls("edit_file", "success", 20)),
			attemptEvent("lm:sparse:1", calls("edit_file", "error", 2)),
		]);
		expect(out).toContain("[insufficient data] lm:sparse:1");
	});

	it("carries the metric's limit into the printed output", async () => {
		const out = await run([attemptEvent("lm:m:1", calls("edit_file", "success", 20))]);
		expect(out).toMatch(/not 'struggles with DIFF FORMAT'/u);
	});

	it("emits JSON on demand", async () => {
		const out = await run([attemptEvent("lm:m:1", calls("edit_file", "success", 20))], { json: true });
		const parsed = JSON.parse(out) as { attemptsRead: number; ranked: { modelId: string }[] };
		expect(parsed.attemptsRead).toBe(1);
		expect(parsed.ranked[0]?.modelId).toBe("lm:m:1");
	});

	it("survives an unreadable ledger as an empty report rather than throwing", async () => {
		const originalWrite = process.stdout.write.bind(process.stdout);
		let out = "";
		process.stdout.write = ((chunk: string) => {
			out += chunk;
			return true;
		}) as typeof process.stdout.write;
		try {
			await runDevEditReliabilityCommand({
				readLedger: async () => {
					throw new Error("ledger gone");
				},
			});
		} finally {
			process.stdout.write = originalWrite;
		}
		expect(out).toContain("0 attempt event(s) read.");
		expect(out).toMatch(/NOT evidence that editing is reliable/u);
	});
});
