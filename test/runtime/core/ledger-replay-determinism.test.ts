import { describe, expect, it } from "vitest";
import {
	compareLedgerReplayDeterminism,
	ledgerStateFingerprint,
	type ReplayEventView,
	replayEventSignature,
} from "../../../src/core/ledger-replay-determinism";

// --- fixture builders: minimal ledger-event views with the deterministic envelope fields explicit ---

function attempt(overrides: Partial<ReplayEventView> = {}): ReplayEventView {
	return {
		kind: "attempt",
		workflowId: "w1",
		taskId: "t1",
		role: "worker",
		recordedAt: 1000,
		modelId: "prov:model:ep",
		endpoint: "ep",
		promptStrategy: "baseline",
		simplificationLevel: 0,
		outcome: "success",
		qualityOk: true,
		retriesBefore: 0,
		salvage: null,
		...overrides,
	};
}

function transition(overrides: Partial<ReplayEventView> = {}): ReplayEventView {
	return {
		kind: "transition",
		workflowId: "w1",
		taskId: "t1",
		role: "worker",
		recordedAt: 2000,
		from: "queued",
		to: "running",
		reason: null,
		controllerDecision: "advance",
		...overrides,
	};
}

function scheduler(overrides: Partial<ReplayEventView> = {}): ReplayEventView {
	return {
		kind: "scheduler",
		workflowId: "w1",
		taskId: "t1",
		role: null,
		recordedAt: 3000,
		event: "lease_acquired",
		detail: "worker-a",
		...overrides,
	};
}

describe("replayEventSignature — causal signature", () => {
	it("ignores non-deterministic envelope fields (eventId, recordedAt)", () => {
		const a = { ...attempt(), recordedAt: 1 } as ReplayEventView & { eventId: string };
		a.eventId = "id-A";
		const b = { ...attempt(), recordedAt: 999_999 } as ReplayEventView & { eventId: string };
		b.eventId = "id-Z";
		expect(replayEventSignature(a)).toBe(replayEventSignature(b));
	});

	it("differs when a causal attempt field differs (outcome)", () => {
		expect(replayEventSignature(attempt({ outcome: "success" }))).not.toBe(
			replayEventSignature(attempt({ outcome: "other_failure" })),
		);
	});

	it("differs when the model identity differs", () => {
		expect(replayEventSignature(attempt({ modelId: "prov:a:ep" }))).not.toBe(
			replayEventSignature(attempt({ modelId: "prov:b:ep" })),
		);
	});

	it("differs when a transition target differs", () => {
		expect(replayEventSignature(transition({ to: "running" }))).not.toBe(
			replayEventSignature(transition({ to: "awaiting_review" })),
		);
	});

	it("differs when a scheduler event name differs", () => {
		expect(replayEventSignature(scheduler({ event: "lease_acquired" }))).not.toBe(
			replayEventSignature(scheduler({ event: "reclaimed" })),
		);
	});

	it("distinguishes events of different kinds even with identical envelopes", () => {
		const base = { workflowId: "w1", taskId: "t1", role: "worker", recordedAt: 5 };
		expect(replayEventSignature({ ...base, kind: "attempt" })).not.toBe(
			replayEventSignature({ ...base, kind: "transition" }),
		);
	});

	it("treats null and absent optional fields identically (stable normalization)", () => {
		const withNull = transition({ reason: null });
		const withAbsent: ReplayEventView = {
			kind: "transition",
			workflowId: "w1",
			taskId: "t1",
			role: "worker",
			from: "queued",
			to: "running",
			controllerDecision: "advance",
		};
		expect(replayEventSignature(withNull)).toBe(replayEventSignature(withAbsent));
	});

	it("a field value cannot forge a field boundary (delimiter-collision guard)", () => {
		// If fields were space-joined, taskId "a b" + role "c" would collide with taskId "a" + role "b c".
		const left = replayEventSignature(transition({ taskId: "a b", role: "c" }));
		const right = replayEventSignature(transition({ taskId: "a", role: "b c" }));
		expect(left).not.toBe(right);
	});

	it("compares an unknown kind on the shared envelope only (forward-compatible, never throws)", () => {
		const futureA: ReplayEventView = { kind: "future_kind", workflowId: "w1", taskId: "t1", role: "r" };
		const futureB: ReplayEventView = { kind: "future_kind", workflowId: "w1", taskId: "t1", role: "r", outcome: "x" };
		// `outcome` is an attempt-only field; for an unknown kind it is not in scope, so the two are equal.
		expect(replayEventSignature(futureA)).toBe(replayEventSignature(futureB));
	});
});

describe("ledgerStateFingerprint — canonical run state", () => {
	it("is identical for logs recording the same facts in a different order", () => {
		const forward = [attempt(), transition(), scheduler()];
		const shuffled = [scheduler(), attempt(), transition()];
		expect(ledgerStateFingerprint(forward)).toBe(ledgerStateFingerprint(shuffled));
	});

	it("differs when one event's causal content differs", () => {
		const base = [attempt({ outcome: "success" }), transition()];
		const drift = [attempt({ outcome: "timeout" }), transition()];
		expect(ledgerStateFingerprint(base)).not.toBe(ledgerStateFingerprint(drift));
	});

	it("differs when an event is missing (different multiset)", () => {
		expect(ledgerStateFingerprint([attempt(), transition()])).not.toBe(ledgerStateFingerprint([attempt()]));
	});

	it("is empty-stable for an empty log", () => {
		expect(ledgerStateFingerprint([])).toBe("");
		expect(ledgerStateFingerprint([])).toBe(ledgerStateFingerprint([]));
	});

	it("is unaffected by envelope non-determinism", () => {
		const a = [attempt({ recordedAt: 1 }), transition({ recordedAt: 2 })];
		const b = [attempt({ recordedAt: 500 }), transition({ recordedAt: 900 })];
		expect(ledgerStateFingerprint(a)).toBe(ledgerStateFingerprint(b));
	});
});

describe("compareLedgerReplayDeterminism — verdict", () => {
	it("reports deterministic + no divergence for two identical logs", () => {
		const log = [attempt(), transition(), scheduler()];
		const report = compareLedgerReplayDeterminism(log, log);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
		expect(report.capturedCount).toBe(3);
		expect(report.replayedCount).toBe(3);
	});

	it("reports deterministic when the same facts were appended in a different order", () => {
		const captured = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20 }), scheduler({ recordedAt: 30 })];
		const replayed = [scheduler({ recordedAt: 30 }), attempt({ recordedAt: 10 }), transition({ recordedAt: 20 })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
	});

	it("localizes a single-event drift to its causal index (event_mismatch)", () => {
		const captured = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20, to: "awaiting_review" })];
		const replayed = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20, to: "failed" })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(false);
		expect(report.firstDivergence?.index).toBe(1);
		expect(report.firstDivergence?.kind).toBe("event_mismatch");
		expect(report.firstDivergence?.capturedSignature).toContain("awaiting_review");
		expect(report.firstDivergence?.replayedSignature).toContain("failed");
	});

	it("reports the FIRST divergence when several positions differ", () => {
		const captured = [attempt({ recordedAt: 10, outcome: "success" }), transition({ recordedAt: 20, to: "a" })];
		const replayed = [attempt({ recordedAt: 10, outcome: "timeout" }), transition({ recordedAt: 20, to: "b" })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.firstDivergence?.index).toBe(0);
		expect(report.firstDivergence?.capturedSignature).toContain("success");
	});

	it("flags a replay that stopped early (captured_longer)", () => {
		const captured = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20 })];
		const replayed = [attempt({ recordedAt: 10 })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(false);
		expect(report.firstDivergence?.index).toBe(1);
		expect(report.firstDivergence?.kind).toBe("captured_longer");
		expect(report.firstDivergence?.capturedSignature).not.toBeNull();
		expect(report.firstDivergence?.replayedSignature).toBeNull();
	});

	it("flags a replay that emitted an extra event (replayed_longer)", () => {
		const captured = [attempt({ recordedAt: 10 })];
		const replayed = [attempt({ recordedAt: 10 }), scheduler({ recordedAt: 20 })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(false);
		expect(report.firstDivergence?.index).toBe(1);
		expect(report.firstDivergence?.kind).toBe("replayed_longer");
		expect(report.firstDivergence?.capturedSignature).toBeNull();
		expect(report.firstDivergence?.replayedSignature).not.toBeNull();
	});

	it("ignores envelope non-determinism — a re-run with fresh uuids/clocks stays deterministic", () => {
		const captured = [
			{ ...attempt({ recordedAt: 1 }), eventId: "cap-1" } as ReplayEventView,
			{ ...transition({ recordedAt: 2 }), eventId: "cap-2" } as ReplayEventView,
		];
		const replayed = [
			{ ...attempt({ recordedAt: 111 }), eventId: "rep-1" } as ReplayEventView,
			{ ...transition({ recordedAt: 222 }), eventId: "rep-2" } as ReplayEventView,
		];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
	});

	it("orders by recordedAt before comparing (interleaved append order is normalized)", () => {
		// Same facts, but the replayed log appended the transition before its (earlier-timestamped) attempt.
		const captured = [attempt({ recordedAt: 10, outcome: "success" }), transition({ recordedAt: 20, to: "running" })];
		const replayed = [transition({ recordedAt: 20, to: "running" }), attempt({ recordedAt: 10, outcome: "success" })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
	});

	it("two empty logs are deterministic with no divergence", () => {
		const report = compareLedgerReplayDeterminism([], []);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
		expect(report.capturedCount).toBe(0);
		expect(report.replayedCount).toBe(0);
	});

	it("is symmetric in whether it detects divergence (captured/replayed swapped)", () => {
		const a = [attempt({ recordedAt: 10, outcome: "success" })];
		const b = [attempt({ recordedAt: 10, outcome: "timeout" })];
		const forward = compareLedgerReplayDeterminism(a, b);
		const backward = compareLedgerReplayDeterminism(b, a);
		expect(forward.deterministic).toBe(false);
		expect(backward.deterministic).toBe(false);
		expect(forward.firstDivergence?.index).toBe(backward.firstDivergence?.index);
		// The signatures swap sides between the two directions.
		expect(forward.firstDivergence?.capturedSignature).toBe(backward.firstDivergence?.replayedSignature);
	});

	it("is a pure function — repeated calls on the same inputs give the same verdict and do not mutate inputs", () => {
		const captured = [attempt({ recordedAt: 20 }), transition({ recordedAt: 10 })];
		const replayed = [transition({ recordedAt: 10 }), attempt({ recordedAt: 20 })];
		const capturedSnapshot = JSON.stringify(captured);
		const first = compareLedgerReplayDeterminism(captured, replayed);
		const second = compareLedgerReplayDeterminism(captured, replayed);
		expect(first).toEqual(second);
		expect(JSON.stringify(captured)).toBe(capturedSnapshot); // input order untouched
	});

	it("a same-state run keeps deterministic=true and firstDivergence=null in agreement", () => {
		// Distinct instants so canonical order is fully determined; identical facts ⇒ both signals agree.
		const captured = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20 }), scheduler({ recordedAt: 30 })];
		const replayed = [attempt({ recordedAt: 10 }), transition({ recordedAt: 20 }), scheduler({ recordedAt: 30 })];
		const report = compareLedgerReplayDeterminism(captured, replayed);
		expect(report.deterministic).toBe(true);
		expect(report.firstDivergence).toBeNull();
	});
});
