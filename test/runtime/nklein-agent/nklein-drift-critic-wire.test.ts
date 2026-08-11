import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RESTATEMENT_RESTARTS } from "../../../src/core/off-track-intervention";
import { clearOffTrackRestartLedger, recordOffTrackRestart } from "../../../src/core/off-track-restart-ledger";
import { createKanbanContextFocusExtension } from "../../../src/nklein-agent/nklein-context-focus-extension";

/**
 * The sink is captured so the tests can assert the RECORDED remedy. Until 2026-08-09 they only asserted that
 * computing it did not throw — a mutation check proved that: replacing the live `restartsSoFar` read with `99`
 * left all nine green. "Did not throw" is not a measurement of what the observation says.
 */
const observations = vi.hoisted(() => [] as { message: string; metadata?: Record<string, unknown> }[]);
vi.mock("../../../src/telemetry/self-observation-sink", () => ({
	recordSelfObservation: (event: { message: string; metadata?: Record<string, unknown> }) => {
		observations.push(event);
	},
	readSelfObservationEvents: async () => [],
}));

/**
 * P18.4b — the FIRST end-to-end coverage of the F12.92 drift-critic path.
 *
 * ── WHY THIS FILE EXISTS ──
 * Found 2026-07-30 while wiring the off-track remedy: **nothing anywhere drove `driftCriticCaller` through the
 * extension.** The critic's detection (F12.92) and everything hanging off it were exercised only by their pure
 * cores, so the path from "a turn happens" → "the critic is consulted" → "its verdict becomes a worker nudge and
 * a remedy observation" had no test at all. The decision cores are well covered; the WIRE between them was not,
 * which is exactly the `enabled_but_silent` shape that P18.3b had just cost a fix to close.
 *
 * The extension is deliberately inert without its opt-in callbacks, so a harness only has to supply the two under
 * test (`driftCriticCaller`, `offTrackSignalsProvider`); every other feature stays off and cannot interfere.
 *
 * Cadence facts this file depends on (`decideDriftCheck`): no check before turn 4, then every 8 turns. With
 * `lastCheckTurn === null` the elapsed count is the turn itself, so **turn 8 is the first turn that checks**.
 */

const OFF_TRACK_REPLY = "DRIFT: rewriting unrelated modules | HINT: return to the card's acceptance criteria";
const ON_TRACK_REPLY = "Looks fine to me.";

function makeContext(iteration: number) {
	// Minimal but REAL shape: `request.messages` feeds the repo-map pass, `request.tools` the offered-tool record,
	// and `snapshot.iteration` drives the drift cadence. Everything else the extension touches sits behind an
	// opt-in callback we deliberately leave undefined, which is what keeps this harness small.
	return {
		snapshot: { iteration, usage: undefined },
		request: { messages: [{ role: "user", content: "build the thing" }], tools: [] },
	} as never;
}

/**
 * ⚠️ Each test MUST use a distinct session id. The extension keeps drift cadence state (`lastCheckTurn`, in-flight
 * guards, pending notes) in MODULE-level maps keyed by session, so two tests sharing an id leak state into each
 * other: the second one sees `lastCheckTurn = 8`, computes zero elapsed turns, and silently never checks. Learned
 * by writing this file — two tests failed for exactly that reason, not for the behaviour they were asserting.
 */
let sessionCounter = 0;

function buildExtension(options: {
	driftReply: string;
	hasCapturedWork?: boolean;
	withSignals?: boolean;
	onCall?: () => void;
}) {
	const driftCriticCaller = vi.fn(async () => {
		options.onCall?.();
		return options.driftReply;
	});
	sessionCounter += 1;
	const sessionId = `session-${sessionCounter}`;
	const extension = createKanbanContextFocusExtension(
		sessionId,
		"/workspaces/task-1",
		"/repo",
		200_000,
		undefined, // twoPhasePickCaller
		undefined, // resultHandleStore
		driftCriticCaller as never,
		undefined, // servingModel
		undefined, // repoSummaryCaller
		options.withSignals === false ? undefined : () => ({ hasCapturedWork: options.hasCapturedWork ?? false }),
	);
	return { extension, driftCriticCaller, sessionId };
}

/** Let the critic's fire-and-forget promise chain settle — it is deliberately OFF the worker's critical path. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

describe("F12.92 drift critic — the wire, end to end", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		observations.length = 0;
		clearOffTrackRestartLedger();
	});

	it("does NOT consult the critic before the turn floor", async () => {
		// A trajectory has to exist before it can be judged; checking at turn 1 would spend a model call on nothing.
		const { extension, driftCriticCaller } = buildExtension({ driftReply: OFF_TRACK_REPLY });
		await extension.hooks?.beforeModel?.(makeContext(1));
		await settle();
		expect(driftCriticCaller).not.toHaveBeenCalled();
	});

	it("consults the critic once the cadence is due", async () => {
		const { extension, driftCriticCaller } = buildExtension({ driftReply: OFF_TRACK_REPLY });
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();
		expect(driftCriticCaller).toHaveBeenCalledTimes(1);
	});

	it("never blocks the worker on the critic — the call is fire-and-forget", async () => {
		// The design contract: an OPTIONAL nudge may not tax every turn with a second model's latency. If
		// `beforeModel` ever awaited the critic, this would hang for the pending duration instead of returning.
		// Initialised to a no-op rather than null: TypeScript narrows a `| null` binding assigned only inside a
		// promise callback down to `never`, which makes the later call a type error.
		let release: () => void = () => undefined;
		const slowCaller = vi.fn(
			async () =>
				await new Promise<string>((resolve) => {
					release = () => resolve(OFF_TRACK_REPLY);
				}),
		);
		const extension = createKanbanContextFocusExtension(
			"session-slow",
			"/workspaces/task-1",
			"/repo",
			200_000,
			undefined,
			undefined,
			slowCaller as never,
			undefined,
			undefined,
			() => ({ hasCapturedWork: false }),
		);
		await extension.hooks?.beforeModel?.(makeContext(8));
		expect(slowCaller).toHaveBeenCalledTimes(1);
		release();
	});

	it("an ON-TRACK verdict injects NOTHING on the following turn", async () => {
		// A critic that always finds something trains the worker to ignore it, so silence is the correct output for
		// a healthy run — and an unparseable reply must read as on-track rather than manufacture feedback.
		const { extension } = buildExtension({ driftReply: ON_TRACK_REPLY });
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();
		const next = (await extension.hooks?.beforeModel?.(makeContext(9))) as
			| { messages?: { metadata?: { kind?: string } }[] }
			| undefined;
		const injected = (next?.messages ?? []).some((message) => message.metadata?.kind === "kanban-drift-critic");
		expect(injected).toBe(false);
	});

	it("an OFF-TRACK verdict becomes a worker nudge on the FOLLOWING turn, not this one", async () => {
		// The two steps are deliberately ordered: inject what the PREVIOUS turn produced, then kick off the next
		// check. A verdict therefore always lands one turn later — that ordering is the whole reason the critic can
		// stay off the critical path.
		//
		// ASSERTED ON TEXT, NOT ON THE `kanban-drift-critic` METADATA MARKER, and that is a real behavioural fact
		// rather than test convenience: the nudge is injected as a `user` message next to the task's own `user`
		// turn, and `mergeConsecutiveSameRoleSdkMessages` at the hook's exit MERGES adjacent same-role messages to
		// stop Mistral-family templates hard-500ing on non-alternating roles. The marker does not survive that
		// merge — so any future check that looks for it would silently pass on an empty result.
		const { extension } = buildExtension({ driftReply: OFF_TRACK_REPLY });
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();
		const next = (await extension.hooks?.beforeModel?.(makeContext(9))) as
			| { messages?: { content?: unknown }[] }
			| undefined;
		expect(next?.messages, "the following turn produced no messages at all").toBeDefined();
		expect(JSON.stringify(next?.messages ?? []), "the flagged verdict never reached the worker").toContain(
			"Possible drift",
		);
	});

	it("stays completely inert when no critic is injected (opt-in contract)", async () => {
		// F12.92 is opt-in; with no caller the whole block must be byte-identical to not having it.
		const extension = createKanbanContextFocusExtension("session-inert", "/workspaces/task-1", "/repo", 200_000);
		await expect(extension.hooks?.beforeModel?.(makeContext(8))).resolves.not.toThrow();
	});

	it("tolerates a critic that throws — a failed nudge must never disturb the run", async () => {
		const throwingCaller = vi.fn(async () => {
			throw new Error("critic endpoint down");
		});
		const extension = createKanbanContextFocusExtension(
			"session-throw",
			"/workspaces/task-1",
			"/repo",
			200_000,
			undefined,
			undefined,
			throwingCaller as never,
			undefined,
			undefined,
			() => ({ hasCapturedWork: false }),
		);
		await expect(extension.hooks?.beforeModel?.(makeContext(8))).resolves.not.toThrow();
		await settle();
		expect(throwingCaller).toHaveBeenCalledTimes(1);
	});

	it("computes the off-track remedy WITHOUT the provider throwing the run (P18.4b observe-only)", async () => {
		// The remedy is observation-only: it must never change what `beforeModel` returns. A card WITH captured work
		// is the interesting case — that is the input that must steer the ladder toward park rather than restart.
		const { extension } = buildExtension({ driftReply: OFF_TRACK_REPLY, hasCapturedWork: true });
		await expect(extension.hooks?.beforeModel?.(makeContext(8))).resolves.not.toThrow();
		await settle();
	});

	it("RECORDS the remedy it chose, not merely computes one", async () => {
		// The gap a mutation check exposed: every assertion here used to be "did not throw", so the recorded
		// remedy — the entire product of this observation — went unread. A regression in the computation would
		// have stayed green.
		const { extension } = buildExtension({ driftReply: OFF_TRACK_REPLY, hasCapturedWork: true });
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();

		const remedy = observations.find((event) => event.metadata?.category === "off_track_remedy_observed");
		expect(remedy, "no off-track remedy was recorded at all").toBeDefined();
		// Captured work parks the card: restarting would destroy artefacts a human could still judge.
		expect(remedy?.message).toMatch(/park/);
	});

	it("reads the restart budget from the LEDGER, so a spent budget changes the recorded remedy", async () => {
		// Covers the live `getOffTrackRestartCount(sessionId)` read. With the budget spent and NO captured work,
		// the honest answer flips from restart to park — and a hard-coded `0` could never produce it, which is
		// exactly what made the observation biased toward `restart_with_restatement` while it was a literal.
		const { extension, sessionId } = buildExtension({ driftReply: OFF_TRACK_REPLY, hasCapturedWork: false });
		for (let spent = 0; spent < MAX_RESTATEMENT_RESTARTS; spent += 1) {
			recordOffTrackRestart(sessionId);
		}

		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();

		const remedy = observations.find((event) => event.metadata?.category === "off_track_remedy_observed");
		expect(remedy?.message).toMatch(/park/);
		expect(remedy?.message).toMatch(/budget/);
	});

	it("and with the budget UNSPENT the same card restarts — the direction that pins the read", async () => {
		// The first version of the test above passed against a hard-coded `99` as happily as against the real
		// read, because a large constant produces the budget-park too. One direction cannot distinguish "read the
		// ledger" from "guessed high". This is the other direction: an EMPTY ledger must yield restart, which no
		// spent-looking constant can produce. The pair pins the read; either alone does not.
		const { extension } = buildExtension({ driftReply: OFF_TRACK_REPLY, hasCapturedWork: false });
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();

		const remedy = observations.find((event) => event.metadata?.category === "off_track_remedy_observed");
		expect(remedy?.message).toMatch(/restart/);
		expect(remedy?.message).not.toMatch(/budget/);
	});

	it("awaits an ASYNC signals provider and records its basis — the repo-probe fold reaches the observation", async () => {
		// P18.4b slice (2026-08-11): the live provider now asks the REPO via foldCapturedWorkProbe when in-memory
		// state says nothing (the in-memory null is what a restarted service reports for exactly the cards whose
		// diff a restart would destroy). This pins the two things that wire depends on: the extension AWAITS a
		// promise-returning provider, and the basis label survives into the recorded metadata — "parked because
		// we could not check" and "parked because there is a diff" must stay distinguishable facts.
		const driftCriticCaller = vi.fn(async () => OFF_TRACK_REPLY);
		sessionCounter += 1;
		const extension = createKanbanContextFocusExtension(
			`session-${sessionCounter}`,
			"/workspaces/task-1",
			"/repo",
			200_000,
			undefined,
			undefined,
			driftCriticCaller as never,
			undefined,
			undefined,
			async () => ({
				hasCapturedWork: true,
				basis: "assumed_safe",
				detail: "probe could not read the repo",
			}),
		);
		await extension.hooks?.beforeModel?.(makeContext(8));
		await settle();

		const remedy = observations.find((event) => event.metadata?.category === "off_track_remedy_observed");
		expect(remedy, "async provider result never reached the observation").toBeDefined();
		expect(remedy?.metadata?.capturedWorkBasis).toBe("assumed_safe");
		expect(remedy?.metadata?.capturedWorkDetail).toBe("probe could not read the repo");
		expect(remedy?.message).toMatch(/park/);
	});

	it("skips the remedy entirely when no signals provider is supplied", async () => {
		// Without real signals the remedy is not computed at all, rather than computed from defaults — defaulting
		// `hasCapturedWork` to false is precisely what would make the ladder prefer RESTART and discard a diff.
		const { extension, driftCriticCaller } = buildExtension({
			driftReply: OFF_TRACK_REPLY,
			withSignals: false,
		});
		await expect(extension.hooks?.beforeModel?.(makeContext(8))).resolves.not.toThrow();
		await settle();
		expect(driftCriticCaller).toHaveBeenCalledTimes(1);
	});
});
