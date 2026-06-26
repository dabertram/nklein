import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAttemptEvent, buildTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import { appendAgentLedgerEvent, readAgentLedger } from "../../../src/state/agent-attempt-ledger-store";

const base = { workflowId: "wf-1", taskId: "t-1", workspacePathHash: "ws-A" };

describe("agent-attempt-ledger-store", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-ledger-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("appends + reads back in chronological order", async () => {
		await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "t1", recordedAt: 20 }), {
			rootDir,
		});
		await appendAgentLedgerEvent(
			buildAttemptEvent({
				...base,
				attemptId: "a1",
				modelId: "m",
				outcome: "success",
				eventId: "e1",
				recordedAt: 10,
			}),
			{ rootDir },
		);
		const events = await readAgentLedger({ workspacePathHash: "ws-A", rootDir });
		// Sorted by recordedAt ASC regardless of append order.
		expect(events.map((event) => event.eventId)).toEqual(["e1", "t1"]);
	});

	it("limit keeps the most-recent N events (the tail)", async () => {
		for (let i = 0; i < 5; i++) {
			await appendAgentLedgerEvent(
				buildAttemptEvent({
					...base,
					attemptId: `a${i}`,
					modelId: "m",
					outcome: "success",
					eventId: `e${i}`,
					recordedAt: i,
				}),
				{ rootDir },
			);
		}
		const recent = await readAgentLedger({ workspacePathHash: "ws-A", rootDir, limit: 2 });
		expect(recent.map((event) => event.eventId)).toEqual(["e3", "e4"]);
	});

	it("isolates events per workspace (one log file per workspacePathHash)", async () => {
		await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "wsA" }), { rootDir });
		await appendAgentLedgerEvent(
			buildTransitionEvent({ ...base, workspacePathHash: "ws-B", to: "plan", eventId: "wsB" }),
			{ rootDir },
		);
		expect((await readAgentLedger({ workspacePathHash: "ws-A", rootDir })).map((e) => e.eventId)).toEqual(["wsA"]);
		expect((await readAgentLedger({ workspacePathHash: "ws-B", rootDir })).map((e) => e.eventId)).toEqual(["wsB"]);
	});

	it("returns an empty array for a workspace with no ledger yet", async () => {
		expect(await readAgentLedger({ workspacePathHash: "never-written", rootDir })).toEqual([]);
	});
});
