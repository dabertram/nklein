import { describe, expect, it } from "vitest";
import {
	runtimeAdwListWorkflowsResponseSchema,
	runtimeAdwRunRequestSchema,
	runtimeAdwRunSnapshotSchema,
	runtimeAdwRunStartResponseSchema,
	runtimeAdwRunStatusRequestSchema,
	runtimeAdwRunStepStatusSchema,
	runtimeAdwWorkflowSummarySchema,
} from "../../../src/core/adw-run-api-contract";

/**
 * Coverage for one of the two modules the CORRECTED sweep found genuinely unexercised (2026-08-09).
 *
 * The ADW runner's wire contract. Three things in it are decisions rather than shapes, and each is the kind that
 * looks like a formality until it is wrong:
 *
 *  · `input` has a DEFAULT and a CAP. The default is what makes an input-less workflow runnable at all; the cap
 *    is the only bound on text that ends up inside a model prompt.
 *  · An INVALID workflow is listed with a reason rather than omitted. A broken workflow missing from the list is
 *    indistinguishable from one that was never written, so the author sees nothing to fix.
 *  · `verdict` and the per-step `status` are closed sets that keep "still running" and "skipped" distinct from
 *    "failed" — a live run rendered as a failure, or a skipped step as a red one, is a wrong answer the UI has
 *    no way to second-guess.
 */
describe("the run request", () => {
	it("defaults a missing input to the empty string", () => {
		// Plenty of workflows take no input. Without the default they would be unrunnable through the contract
		// while being perfectly runnable in fact.
		expect(runtimeAdwRunRequestSchema.parse({ name: "nightly" })).toEqual({ name: "nightly", input: "" });
	});

	it("keeps a supplied input verbatim, whitespace included", () => {
		const input = "  two words\nand a newline  ";
		expect(runtimeAdwRunRequestSchema.parse({ name: "w", input }).input).toBe(input);
	});

	it("accepts input right up to the cap and rejects one character past it", () => {
		// Pinned at the boundary, because an off-by-one here is invisible in normal use and only shows up on the
		// one input someone actually cared about.
		expect(runtimeAdwRunRequestSchema.safeParse({ name: "w", input: "x".repeat(4_000) }).success).toBe(true);
		expect(runtimeAdwRunRequestSchema.safeParse({ name: "w", input: "x".repeat(4_001) }).success).toBe(false);
	});

	it("requires a non-empty workflow name", () => {
		// An empty name would reach the runner as a lookup for "", which finds nothing and reports it as a missing
		// workflow rather than as a malformed request.
		expect(runtimeAdwRunRequestSchema.safeParse({ name: "" }).success).toBe(false);
		expect(runtimeAdwRunRequestSchema.safeParse({ input: "x" }).success).toBe(false);
	});

	it("requires a non-empty run id when polling", () => {
		expect(runtimeAdwRunStatusRequestSchema.safeParse({ runId: "r1" }).success).toBe(true);
		expect(runtimeAdwRunStatusRequestSchema.safeParse({ runId: "" }).success).toBe(false);
	});
});

describe("listing workflows", () => {
	const summary = (over: Record<string, unknown> = {}) => ({
		name: "nightly",
		description: "runs the nightly cells",
		stepCount: 4,
		agentStepCount: 2,
		invalid: null,
		...over,
	});

	it("LISTS a broken workflow with its reason instead of hiding it", () => {
		// The important one. A workflow that fails to parse is still a workflow the author wrote; omitting it makes
		// a broken file look like a missing one, and nobody goes looking for a fix to a file they cannot see.
		const parsed = runtimeAdwWorkflowSummarySchema.parse(
			summary({ invalid: "step 3 names an unknown agent", stepCount: 0, agentStepCount: 0 }),
		);

		expect(parsed.invalid).toBe("step 3 names an unknown agent");
	});

	it("distinguishes a healthy workflow by a NULL reason, not an empty one", () => {
		expect(runtimeAdwWorkflowSummarySchema.parse(summary()).invalid).toBeNull();
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ invalid: undefined })).success).toBe(false);
	});

	it("allows a null description but not a missing one", () => {
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ description: null })).success).toBe(true);
		const { description: _dropped, ...withoutDescription } = summary();
		expect(runtimeAdwWorkflowSummarySchema.safeParse(withoutDescription).success).toBe(false);
	});

	it("requires the step counts to be non-negative integers", () => {
		// These drive a progress display. A fractional or negative count renders as nonsense and, worse, makes a
		// completed run look unfinished.
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ stepCount: 0 })).success).toBe(true);
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ stepCount: -1 })).success).toBe(false);
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ stepCount: 1.5 })).success).toBe(false);
		expect(runtimeAdwWorkflowSummarySchema.safeParse(summary({ agentStepCount: -1 })).success).toBe(false);
	});

	it("accepts an empty workflow list", () => {
		expect(runtimeAdwListWorkflowsResponseSchema.parse({ ok: true, workflows: [] })).toEqual({
			ok: true,
			workflows: [],
		});
	});

	it("rejects the whole list if one summary is malformed", () => {
		const response = { ok: true, workflows: [summary(), summary({ stepCount: -1 })] };

		expect(runtimeAdwListWorkflowsResponseSchema.safeParse(response).success).toBe(false);
	});
});

describe("starting a run", () => {
	it("carries a run id on success and a reason on failure", () => {
		// Both fields are nullable so the two outcomes are representable without a second shape — but a start that
		// reported neither would leave the caller polling an id it does not have.
		expect(runtimeAdwRunStartResponseSchema.parse({ ok: true, runId: "r1", error: null }).runId).toBe("r1");
		expect(runtimeAdwRunStartResponseSchema.parse({ ok: false, runId: null, error: "no such workflow" }).error).toBe(
			"no such workflow",
		);
	});

	it("requires both fields to be STATED, even when null", () => {
		// An absent `error` and an explicit `null` read the same to a consumer, but only one of them proves the
		// server considered the question.
		expect(runtimeAdwRunStartResponseSchema.safeParse({ ok: true, runId: "r1" }).success).toBe(false);
		expect(runtimeAdwRunStartResponseSchema.safeParse({ ok: false, error: "x" }).success).toBe(false);
	});
});

describe("a run snapshot", () => {
	const step = (over: Record<string, unknown> = {}) => ({
		id: "s1",
		kind: "agent",
		status: "running",
		detail: null,
		cardId: null,
		...over,
	});
	const snapshot = (over: Record<string, unknown> = {}) => ({
		runId: "r1",
		name: "nightly",
		input: "",
		startedAt: 1,
		finishedAt: null,
		verdict: "running",
		steps: [step()],
		evidenceDir: null,
		error: null,
		...over,
	});

	it("represents a LIVE run: no finish time, verdict still running", () => {
		// The UI polls while this is true. Forcing a finishedAt would make every in-flight run look finished.
		const parsed = runtimeAdwRunSnapshotSchema.parse(snapshot());

		expect(parsed.finishedAt).toBeNull();
		expect(parsed.verdict).toBe("running");
	});

	it("keeps `running` out of the terminal verdicts", () => {
		for (const verdict of ["running", "pass", "fail"]) {
			expect(runtimeAdwRunSnapshotSchema.safeParse(snapshot({ verdict })).success, verdict).toBe(true);
		}
		for (const verdict of ["passed", "error", "", null]) {
			expect(runtimeAdwRunSnapshotSchema.safeParse(snapshot({ verdict })).success, String(verdict)).toBe(false);
		}
	});

	it("keeps SKIPPED distinct from FAIL and from PENDING", () => {
		// Three different facts about a step that never produced a result, and collapsing any pair misattributes
		// either a failure or a completion.
		for (const status of ["pending", "running", "ok", "fail", "skipped"]) {
			expect(runtimeAdwRunStepStatusSchema.safeParse(step({ status })).success, status).toBe(true);
		}
		expect(runtimeAdwRunStepStatusSchema.safeParse(step({ status: "cancelled" })).success).toBe(false);
	});

	it("distinguishes a deterministic step from an agent step", () => {
		// Only agent steps cost a model session; conflating them would misreport what a run actually spent.
		expect(runtimeAdwRunStepStatusSchema.safeParse(step({ kind: "deterministic" })).success).toBe(true);
		expect(runtimeAdwRunStepStatusSchema.safeParse(step({ kind: "manual" })).success).toBe(false);
	});

	it("lets a step name the card it produced, or state that it produced none", () => {
		expect(runtimeAdwRunStepStatusSchema.parse(step({ cardId: "card-9" })).cardId).toBe("card-9");
		expect(runtimeAdwRunStepStatusSchema.parse(step()).cardId).toBeNull();
		const { cardId: _dropped, ...withoutCardId } = step();
		expect(runtimeAdwRunStepStatusSchema.safeParse(withoutCardId).success).toBe(false);
	});

	it("accepts a finished run with an evidence directory", () => {
		const parsed = runtimeAdwRunSnapshotSchema.parse(
			snapshot({ finishedAt: 99, verdict: "pass", evidenceDir: "/evidence/r1", steps: [step({ status: "ok" })] }),
		);

		expect(parsed).toMatchObject({ finishedAt: 99, verdict: "pass", evidenceDir: "/evidence/r1" });
	});

	it("accepts a run with NO steps — a workflow that failed before any step ran", () => {
		expect(
			runtimeAdwRunSnapshotSchema.safeParse(snapshot({ steps: [], verdict: "fail", error: "could not load" }))
				.success,
		).toBe(true);
	});
});
