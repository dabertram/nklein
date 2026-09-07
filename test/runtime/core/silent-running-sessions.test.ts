import { describe, expect, it } from "vitest";
import {
	DEFAULT_SILENT_RUNNING_RECONCILE_MS,
	listSilentRunningSessions,
} from "../../../src/core/silent-running-sessions";
import type { RuntimeTaskSessionSummary } from "../../../src/core/task-session-api-contract";

/** 2026-08-20 23:29:01 local — the moment run-3's record-only `trouble_silent` fired (`.real-runs/20260820-222524`). */
const NOW = 1_787_261_341_616;
/** The bounce: running → awaiting_review(hook) → running, 20 min 18 s before NOW (ledger `card-transitions.jsonl`). */
const BOUNCE_AT = NOW - DEFAULT_SILENT_RUNNING_RECONCILE_MS - 18_000;

const board = {
	columns: [
		{ id: "backlog", cards: [{ id: "waiting" }] },
		{ id: "planning", cards: [{ id: "architect" }] },
		{ id: "ready", cards: [{ id: "released" }] },
		{ id: "in_progress", cards: [{ id: "worker" }] },
		{ id: "review", cards: [{ id: "judged" }] },
		{ id: "completed", cards: [{ id: "done" }] },
		{ id: "trash", cards: [{ id: "binned" }] },
	],
};

/**
 * The run-3 zombie shape: the label says `running` with a healthy-looking heartbeat, every stamp is the 20-minute-old
 * bounce (the adapter's tool-event revival renewed heartbeat/hook/output), tokens WERE produced earlier, no turn open.
 */
function summary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "architect",
		state: "running",
		agentId: "nklein",
		workspacePath: "/tmp/ws",
		pid: null,
		startedAt: NOW - 60 * 60_000,
		updatedAt: BOUNCE_AT,
		lastOutputAt: BOUNCE_AT,
		lastTokenAt: BOUNCE_AT - 30_000,
		firstTurnSentAt: NOW - 59 * 60_000,
		lastHeartbeatAt: BOUNCE_AT,
		lastHookAt: BOUNCE_AT,
		heartbeatStatus: "healthy",
		reviewReason: null,
		exitCode: null,
		latestHookActivity: {
			activityText: "Using read_files",
			toolName: "read_files",
			toolInputSummary: null,
			finalMessage: null,
			hookEventName: "tool_call",
			notificationType: null,
			source: "nklein-sdk",
		},
		...overrides,
	} as RuntimeTaskSessionSummary;
}

describe("listSilentRunningSessions (P0.DSTALL post-first-token liveness)", () => {
	it("flags run-3's plan-mode zombie: a running Planning card silent past the trouble threshold", () => {
		const findings = listSilentRunningSessions(board, [summary()], NOW);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ taskId: "architect", columnId: "planning" });
		expect(findings[0]?.silentMs).toBe(DEFAULT_SILENT_RUNNING_RECONCILE_MS + 18_000);
		expect(findings[0]?.ageMs).toBe(60 * 60_000);
		expect(findings[0]?.reason).toContain("no liveness evidence");
		expect(findings[0]?.reason).toContain("heartbeat healthy");
		expect(findings[0]?.reason).toContain("last activity tool_call");
	});

	it("does not let a healthy/stale/lost LABEL exempt a silent session — the label is the lie being reconciled", () => {
		for (const heartbeatStatus of ["healthy", "stale", "lost", null, undefined] as const) {
			expect(listSilentRunningSessions(board, [summary({ heartbeatStatus })], NOW)).toHaveLength(1);
		}
	});

	it("leaves the pre-first-token window to the zero-token wedge sweep", () => {
		expect(listSilentRunningSessions(board, [summary({ lastTokenAt: null })], NOW)).toHaveLength(0);
		expect(listSilentRunningSessions(board, [summary({ lastTokenAt: undefined })], NOW)).toHaveLength(0);
	});

	it("keeps a session that showed ANY liveness inside the bound (a queued admission wait renews the heartbeat)", () => {
		expect(listSilentRunningSessions(board, [summary({ lastHeartbeatAt: NOW - 60_000 })], NOW)).toHaveLength(0);
		expect(listSilentRunningSessions(board, [summary({ lastHookAt: NOW - 60_000 })], NOW)).toHaveLength(0);
		expect(listSilentRunningSessions(board, [summary({ lastOutputAt: NOW - 60_000 })], NOW)).toHaveLength(0);
		expect(listSilentRunningSessions(board, [summary({ lastTokenAt: NOW - 60_000 })], NOW)).toHaveLength(0);
		// Exactly AT the bound is still inside it — the sweep fires strictly past the threshold.
		expect(
			listSilentRunningSessions(
				board,
				[summary({ lastHeartbeatAt: NOW - DEFAULT_SILENT_RUNNING_RECONCILE_MS })],
				NOW,
			),
		).toHaveLength(0);
	});

	it("ages from the NEWEST stamp — old stamps beside one fresh one are not silence", () => {
		const oldTokenFreshHeartbeat = summary({
			lastTokenAt: NOW - 3 * 60 * 60_000,
			lastOutputAt: NOW - 2 * 60 * 60_000,
			lastHookAt: NOW - 90 * 60_000,
			lastHeartbeatAt: NOW - 5_000,
		});
		expect(listSilentRunningSessions(board, [oldTokenFreshHeartbeat], NOW)).toHaveLength(0);
		// Missing sibling stamps fall back to the token stamp alone.
		const tokenOnly = summary({ lastHeartbeatAt: null, lastHookAt: null, lastOutputAt: null });
		expect(listSilentRunningSessions(board, [tokenOnly], NOW)[0]?.silentMs).toBe(NOW - (BOUNCE_AT - 30_000));
	});

	it("exempts a session with a tool call in flight (the service's tool timeout owns tool execution)", () => {
		expect(
			listSilentRunningSessions(board, [summary()], NOW, { toolActiveTaskIds: new Set(["architect"]) }),
		).toHaveLength(0);
		expect(
			listSilentRunningSessions(board, [summary()], NOW, { toolActiveTaskIds: new Set(["worker"]) }),
		).toHaveLength(1);
	});

	it("covers every working lane (planning, in_progress, review) and nothing else", () => {
		const findings = listSilentRunningSessions(
			board,
			[
				summary({ taskId: "architect" }),
				summary({ taskId: "worker" }),
				summary({ taskId: "judged" }),
				summary({ taskId: "waiting" }),
				summary({ taskId: "released" }),
				summary({ taskId: "done" }),
				summary({ taskId: "binned" }),
				summary({ taskId: "absent-from-board" }),
				summary({ taskId: "architect::review" }),
				summary({ taskId: "worker::spec" }),
				summary({ taskId: "__home_agent__:ws:nklein" }),
			],
			NOW,
		);
		expect(findings.map((finding) => [finding.taskId, finding.columnId])).toEqual([
			["architect", "planning"],
			["worker", "in_progress"],
			["judged", "review"],
		]);
	});

	it("skips non-running and paused summaries", () => {
		for (const state of ["queued", "awaiting_review", "interrupted", "failed", "idle", "paused"] as const) {
			expect(listSilentRunningSessions(board, [summary({ state })], NOW)).toHaveLength(0);
		}
		expect(listSilentRunningSessions(board, [summary({ paused: true })], NOW)).toHaveLength(0);
	});

	it("honours a custom bound and rejects a nonsensical one", () => {
		const fiveMinutesSilent = summary({
			lastHeartbeatAt: NOW - 5 * 60_000,
			lastHookAt: NOW - 5 * 60_000,
			lastOutputAt: NOW - 5 * 60_000,
			lastTokenAt: NOW - 5 * 60_000,
		});
		expect(listSilentRunningSessions(board, [fiveMinutesSilent], NOW, { silentAfterMs: 60_000 })).toHaveLength(1);
		// invalid bounds fall back to the (not yet exceeded) default
		expect(listSilentRunningSessions(board, [fiveMinutesSilent], NOW, { silentAfterMs: -5 })).toHaveLength(0);
		expect(listSilentRunningSessions(board, [fiveMinutesSilent], NOW, { silentAfterMs: Number.NaN })).toHaveLength(0);
		expect(listSilentRunningSessions(board, [fiveMinutesSilent], NOW)).toHaveLength(0);
	});

	it("reports one finding per card even when the board shadows it in two lanes and summaries repeat", () => {
		const shadowed = {
			columns: [
				{ id: "planning", cards: [{ id: "architect" }] },
				{ id: "in_progress", cards: [{ id: "architect" }] },
			],
		};
		const findings = listSilentRunningSessions(shadowed, [summary(), summary()], NOW);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.columnId).toBe("planning");
	});

	it("reports 0 age for a session without a start stamp instead of refusing to judge it", () => {
		const findings = listSilentRunningSessions(board, [summary({ startedAt: null })], NOW);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.ageMs).toBe(0);
	});

	it("is total on malformed input", () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		expect(listSilentRunningSessions(null as any, [summary()], NOW)).toEqual([]);
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		expect(listSilentRunningSessions({ columns: null as any }, [summary()], NOW)).toEqual([]);
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed
		expect(listSilentRunningSessions(board, null as any, NOW)).toEqual([]);
		expect(listSilentRunningSessions(board, [summary()], Number.NaN)).toEqual([]);
	});
});
