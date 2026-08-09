import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { extractOperatorHold, findResultBranchForCard } from "../../src/core/operator-hold-extraction";

/**
 * N16's ACCEPTANCE FIXTURE — the real 2026-07-20 `s03` hold, replayed.
 *
 * N16 names this run as its acceptance case: *"s03, workspace_disposed_before_capture, 22 dependents blocked,
 * work intact on a result branch. Use it as the acceptance fixture for this item."*
 *
 * ⚠️ **THE STRINGS BELOW ARE TRANSCRIBED FROM THE REAL RUN, NOT INVENTED.** The retained HOME has since been
 * cleaned up, so this fixture is the only surviving copy — which is precisely why it is worth having. Both
 * defects this guards were found by running the extractor against that HOME once, and neither is recoverable by
 * reading the code: the extractor produced a complete, confident, well-formed report with the two decisive
 * fields wrong.
 *
 * Note the ORDER of the telemetry blob: `s00`'s branch is written BEFORE `s03`'s, exactly as it was in the real
 * run. That ordering is the fixture's whole point — an unscoped branch match passes every other assertion here
 * and still sends a reader to inspect a healthy card's intact work.
 */

const HELD_CARD = "clinical-medication-safety-platform-s03";
const S03_BRANCH = "nklein/tasks/clinical-medication-safety-platform-s03-0c79713502";
const S00_BRANCH = "nklein/tasks/clinical-medication-safety-platform-s00-a41f8ee217";

const RUNTIME_LOG = [
	"[review-phase] clinical-medication-safety-platform-s03 round 1 verdict=request_changes",
	"[review-phase] clinical-medication-safety-platform-s03 bounced to worker (round 2)",
	"[review-phase] clinical-medication-safety-platform-s03 round 2 verdict=request_changes",
	"[review-phase] clinical-medication-safety-platform-s03 bounced to worker (round 3)",
	`Task result capture failed for ${HELD_CARD}; held in Review for operator attention`,
	"[review-phase] clinical-medication-safety-platform-s00 round 1 verdict=approve",
].join("\n");

/** Self-observation telemetry. Carries the reason CODE and the branch refs — runtime.log carries neither. */
const TELEMETRY = [
	`{"message":"Sandbox task result branch updated: ${S00_BRANCH}"}`,
	`{"message":"Could not capture sandbox task result patch: workspace_disposed_before_capture"}`,
	`{"message":"Sandbox task result branch updated: ${S03_BRANCH}"}`,
].join("\n");

/** 21 dependents behind s03, as the real board had. */
const BOARD_JSON = JSON.stringify({
	dependencies: Array.from({ length: 21 }, (_, index) => ({
		fromTaskId: `clinical-medication-safety-platform-d${String(index).padStart(2, "0")}`,
		toTaskId: HELD_CARD,
	})),
});

function extract(overrides: Partial<Parameters<typeof extractOperatorHold>[0]> = {}) {
	return extractOperatorHold({
		runtimeLog: RUNTIME_LOG,
		telemetryText: TELEMETRY,
		boardJson: BOARD_JSON,
		cellId: "01 × perfect",
		seed: "7",
		...overrides,
	});
}

describe("N16 acceptance — the real s03 operator hold", () => {
	it("produces all FIVE evidence items N16 requires", () => {
		const result = extract();
		expect(result).not.toBeNull();
		const { evidence } = result as NonNullable<typeof result>;

		// 1. the held card + the hold REASON CODE
		expect(evidence.cardId).toBe(HELD_CARD);
		expect(evidence.reasonCode).toBe("workspace_disposed_before_capture");
		// 2. the full processing chain for that card
		expect(evidence.processingChain.length).toBeGreaterThanOrEqual(5);
		expect(evidence.processingChain.some((step) => step.line.includes("verdict=request_changes"))).toBe(true);
		// 3. the DEPENDENT SUBTREE — the actual severity
		expect(evidence.blockedDependents).toHaveLength(21);
		// 4. the artefacts that SURVIVED
		expect(evidence.survivingArtefacts[0]?.ref).toBe(S03_BRANCH);
		// 5. seed + cell, so the run can be repeated
		expect(evidence.seed).toBe("7");
		expect(evidence.cellId).toBe("01 × perfect");
	});

	it("REGRESSION (defect 1): reads the reason code from TELEMETRY, which runtime.log does not carry", () => {
		// Reading the log alone yielded `unknown` on the real run — a report naming no cause, while looking whole.
		const logOnly = extract({ telemetryText: "" });
		expect(logOnly?.evidence.reasonCode).toBe("unknown");
		// With telemetry present the same log classifies correctly. If this pair ever agrees, the source order broke.
		expect(extract()?.evidence.reasonCode).toBe("workspace_disposed_before_capture");
	});

	it("REGRESSION (defect 2): picks s03's branch even though s00's is written FIRST", () => {
		// The real failure. An unscoped match returns S00_BRANCH here and every other assertion still passes —
		// which is why this needs its own test rather than trusting the acceptance case above.
		expect(findResultBranchForCard(TELEMETRY, HELD_CARD)).toBe(S03_BRANCH);
		expect(findResultBranchForCard(TELEMETRY, HELD_CARD)).not.toBe(S00_BRANCH);
	});

	it("says the work SURVIVED, because that decides which remedies are sensible", () => {
		// The hold's premise is that nothing may proceed as if a result branch existed — and one did.
		expect(extract()?.evidence.summary).toContain("WORK SURVIVED");
		expect(extract()?.evidence.summary).toContain("would discard it");
	});

	it("reports an unreadable board as UNKNOWN dependents, never as zero", () => {
		// Zero is the reading that makes a run which stalled 21 cards look harmless.
		const noBoard = extract({ boardJson: null });
		expect(noBoard?.dependentsUnknown).toBe(true);
		expect(noBoard?.note).toContain("UNKNOWN rather than zero");
	});

	it("treats a MALFORMED board as unreadable rather than as an empty dependency set", () => {
		const broken = extract({ boardJson: "{not json" });
		expect(broken?.dependentsUnknown).toBe(true);
	});

	it("does not report a hold when the run held nothing", () => {
		expect(extract({ runtimeLog: "[review-phase] everything fine\n" })).toBeNull();
	});

	it("prescribes no remedy — the hold is deliberate, and the fix is a product decision", () => {
		const summary = extract()?.evidence.summary ?? "";
		expect(summary).toContain("NOT a defect");
		expect(summary).not.toMatch(/re-?drive|retry automatically/i);
	});
});

/**
 * A SOURCE RATCHET, in the style of the P21.1 edit-kind ratchet: the thing being protected here is the WORDING
 * of an operator-facing note, which no behavioural assertion reaches — the message is built inline at the
 * capture site and only ever read by a human.
 *
 * N3's silent-architect cell showed why it matters. A decomposition turn that never emits a tool call ends with
 * `workspace_disposed_before_capture`, and the note used to say "inspect diagnostics and redrive the task" —
 * advice that, for that card, loops: the redrive fails identically. The honest half ("the result is unknown")
 * must survive, because the workspace really was gone before it could be read; only the advice was wrong.
 */
describe("the workspace-unavailable note", () => {
	it("keeps the honest claim and drops the unconditional redrive advice", async () => {
		const source = await readFile(
			new URL("../../src/nklein-agent/nklein-sandbox-review-finalizer.ts", import.meta.url),
			"utf8",
		);

		// The absence half: "unknown" must not be allowed to read as "nothing was produced".
		expect(source).toContain("NOT evidence the card produced nothing");
		// The advice half: check before redriving, rather than redrive.
		expect(source).toMatch(/Check the card's attempts for tool calls BEFORE redriving/);
		expect(source).not.toMatch(/inspect diagnostics and redrive the task/);
	});
});
