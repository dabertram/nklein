import { describe, expect, it } from "vitest";
import {
	findRecentTokenEvidence,
	RECENT_TOKEN_EVIDENCE_WINDOW_MS,
} from "../../../src/core/model-recent-token-evidence";

/**
 * P0.POOLLOSS false positive (measured 2026-09-14): the wedge classifier's 12-second probe called the HITL agent
 * seat `listed_but_dead` 14 times because it answers in ~1.5 minutes. A served token from ANOTHER session on the
 * same (model, endpoint) refutes that verdict; everything uncertain must read as ALIVE, because the wrong "dead"
 * costs the fleet a model for 15 minutes to 4 hours and paused 17 cards, while a wrong "alive" costs one wedge cycle.
 */
const NOW = 1_760_000_000_000;

function witness(over: Partial<Parameters<typeof findRecentTokenEvidence>[0]["witnesses"][number]> = {}) {
	return {
		taskId: "other-card",
		modelId: "claude-hitl",
		endpoint: "http://127.0.0.1:8095/v1",
		lastTokenAt: NOW - 60_000,
		...over,
	};
}

describe("findRecentTokenEvidence", () => {
	it("finds a recent token from another session on the same model and endpoint", () => {
		const evidence = findRecentTokenEvidence({
			modelId: "claude-hitl",
			endpoint: "http://127.0.0.1:8095/v1",
			witnesses: [witness()],
			excludeTaskId: "wedged-card",
			nowMs: NOW,
		});
		expect(evidence).toEqual({ taskId: "other-card", servedAtMs: NOW - 60_000, endpointAssumed: false });
	});

	it("never lets the wedged session witness for itself — it is token-less by definition", () => {
		const evidence = findRecentTokenEvidence({
			modelId: "claude-hitl",
			endpoint: "http://127.0.0.1:8095/v1",
			witnesses: [witness({ taskId: "wedged-card" })],
			excludeTaskId: "wedged-card",
			nowMs: NOW,
		});
		expect(evidence).toBeNull();
	});

	it("returns the MOST RECENT witness so the observation can name what refuted the verdict", () => {
		const evidence = findRecentTokenEvidence({
			modelId: "claude-hitl",
			endpoint: "http://127.0.0.1:8095/v1",
			witnesses: [
				witness({ taskId: "older", lastTokenAt: NOW - 600_000 }),
				witness({ taskId: "newer", lastTokenAt: NOW - 30_000 }),
			],
			nowMs: NOW,
		});
		expect(evidence?.taskId).toBe("newer");
	});

	it("falls back to lastOutputAt when no token timestamp exists, and ignores a witness with neither", () => {
		expect(
			findRecentTokenEvidence({
				modelId: "claude-hitl",
				witnesses: [witness({ lastTokenAt: null, lastOutputAt: NOW - 120_000 })],
				nowMs: NOW,
			})?.servedAtMs,
		).toBe(NOW - 120_000);
		expect(
			findRecentTokenEvidence({
				modelId: "claude-hitl",
				witnesses: [witness({ lastTokenAt: null, lastOutputAt: null })],
				nowMs: NOW,
			}),
		).toBeNull();
	});

	it("ignores evidence older than the window, and a timestamp from the future", () => {
		expect(
			findRecentTokenEvidence({
				modelId: "claude-hitl",
				witnesses: [witness({ lastTokenAt: NOW - RECENT_TOKEN_EVIDENCE_WINDOW_MS - 1 })],
				nowMs: NOW,
			}),
		).toBeNull();
		expect(
			findRecentTokenEvidence({
				modelId: "claude-hitl",
				witnesses: [witness({ lastTokenAt: NOW + 60_000 })],
				nowMs: NOW,
			}),
		).toBeNull();
	});

	it("does not accept a DIFFERENT host's copy of the same model id when both endpoints are known", () => {
		expect(
			findRecentTokenEvidence({
				modelId: "dirk-qwen3.8-27b",
				endpoint: "http://192.168.68.103:1234/v1",
				witnesses: [witness({ modelId: "dirk-qwen3.8-27b", endpoint: "http://192.168.68.101:1234/v1" })],
				nowMs: NOW,
			}),
		).toBeNull();
	});

	it("matches on the model id alone when either side names no endpoint (uncertainty reads as ALIVE)", () => {
		const noCallerEndpoint = findRecentTokenEvidence({
			modelId: "claude-hitl",
			endpoint: null,
			witnesses: [witness()],
			nowMs: NOW,
		});
		expect(noCallerEndpoint).toMatchObject({ taskId: "other-card", endpointAssumed: true });
		const noWitnessEndpoint = findRecentTokenEvidence({
			modelId: "claude-hitl",
			endpoint: "http://127.0.0.1:8095/v1",
			witnesses: [witness({ endpoint: null })],
			nowMs: NOW,
		});
		expect(noWitnessEndpoint).toMatchObject({ endpointAssumed: true });
	});

	it("ignores other models entirely, and a blank model id asks nothing", () => {
		expect(
			findRecentTokenEvidence({
				modelId: "claude-hitl",
				witnesses: [witness({ modelId: "qwen/qwen3.8-27b" })],
				nowMs: NOW,
			}),
		).toBeNull();
		expect(findRecentTokenEvidence({ modelId: "   ", witnesses: [witness()], nowMs: NOW })).toBeNull();
	});
});
