import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRoutingDecisionRecord } from "../../../src/core/routing-decision-log";
import { appendRoutingDecision, readAllRoutingDecisions } from "../../../src/state/routing-decision-log-store";

describe("routing-decision-log-store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "routing-decision-store-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns [] when the log does not exist yet", async () => {
		expect(await readAllRoutingDecisions({ rootDir: root })).toEqual([]);
	});

	it("round-trips appended decisions through the validated jsonl log", async () => {
		await appendRoutingDecision(
			buildRoutingDecisionRecord({
				taskId: "t1",
				routeType: "assign",
				predictedModelKey: "m",
				difficulty: 40,
				uncertainty: null,
				recordedAt: 1,
			}),
			{ rootDir: root },
		);
		await appendRoutingDecision(
			buildRoutingDecisionRecord({
				taskId: "t2",
				routeType: "escalate",
				difficulty: 90,
				uncertainty: null,
				recordedAt: 2,
			}),
			{ rootDir: root },
		);
		const back = await readAllRoutingDecisions({ rootDir: root });
		expect(back).toHaveLength(2);
		expect(back.map((r) => r.routeType)).toEqual(["assign", "escalate"]);
		expect(back[0]?.predictedModelKey).toBe("m");
		// escalate carries no model — the builder nulls it.
		expect(back[1]?.predictedModelKey).toBeNull();
	});
});
