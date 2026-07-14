import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAttemptEvent, buildTransitionEvent } from "../../../src/core/agent-attempt-ledger";
import {
	appendAgentLedgerEvent,
	readAgentLedger,
	readAllAgentLedger,
	runWithAgentLedgerRoot,
} from "../../../src/state/agent-attempt-ledger-store";

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

	it("F1.26b: runWithAgentLedgerRoot scopes an unscoped append/read to the isolated dir (default sees nothing)", async () => {
		const isolated = await mkdtemp(join(tmpdir(), "nklein-ledger-iso-"));
		try {
			// Inside the scope, an append with NO explicit rootDir lands in `isolated`, and a scoped read sees it.
			const scopedRead = await runWithAgentLedgerRoot(isolated, async () => {
				await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "scoped" }));
				return readAgentLedger({ workspacePathHash: "ws-A" });
			});
			expect(scopedRead.map((e) => e.eventId)).toEqual(["scoped"]);
			// The event is physically in the isolated dir (a direct read of that dir sees it)...
			expect(
				(await readAgentLedger({ workspacePathHash: "ws-A", rootDir: isolated })).map((e) => e.eventId),
			).toEqual(["scoped"]);
			// ...and NOT in the beforeEach `rootDir` (the scope did not leak into the default/other roots).
			expect(await readAgentLedger({ workspacePathHash: "ws-A", rootDir })).toEqual([]);
		} finally {
			await rm(isolated, { recursive: true, force: true });
		}
	});

	it("F1.26b: an explicit rootDir arg wins over the ambient scope", async () => {
		const isolated = await mkdtemp(join(tmpdir(), "nklein-ledger-iso-"));
		try {
			await runWithAgentLedgerRoot(isolated, async () => {
				// Explicit rootDir overrides the scope → the event goes to `rootDir`, not `isolated`.
				await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "explicit" }), {
					rootDir,
				});
			});
			expect((await readAgentLedger({ workspacePathHash: "ws-A", rootDir })).map((e) => e.eventId)).toEqual([
				"explicit",
			]);
			expect(await readAgentLedger({ workspacePathHash: "ws-A", rootDir: isolated })).toEqual([]);
		} finally {
			await rm(isolated, { recursive: true, force: true });
		}
	});

	it("F1.26b: NKLEIN_AGENT_LEDGER_ROOT env override directs unscoped writes (for the subprocess capture)", async () => {
		const isolated = await mkdtemp(join(tmpdir(), "nklein-ledger-env-"));
		const prev = process.env.NKLEIN_AGENT_LEDGER_ROOT;
		process.env.NKLEIN_AGENT_LEDGER_ROOT = isolated;
		try {
			// No explicit rootDir, no scope — the env override decides the root.
			await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "env" }));
			expect(
				(await readAgentLedger({ workspacePathHash: "ws-A", rootDir: isolated })).map((e) => e.eventId),
			).toEqual(["env"]);
			// An explicit arg still wins over the env override.
			await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "arg" }), { rootDir });
			expect((await readAgentLedger({ workspacePathHash: "ws-A", rootDir })).map((e) => e.eventId)).toEqual(["arg"]);
		} finally {
			if (prev === undefined) {
				delete process.env.NKLEIN_AGENT_LEDGER_ROOT;
			} else {
				process.env.NKLEIN_AGENT_LEDGER_ROOT = prev;
			}
			await rm(isolated, { recursive: true, force: true });
		}
	});

	it("readAllAgentLedger merges every workspace's events, chronological; empty when the dir is absent", async () => {
		expect(await readAllAgentLedger({ rootDir: join(rootDir, "nope") })).toEqual([]);
		await appendAgentLedgerEvent(buildTransitionEvent({ ...base, to: "plan", eventId: "a", recordedAt: 5 }), {
			rootDir,
		});
		await appendAgentLedgerEvent(
			buildTransitionEvent({ ...base, workspacePathHash: "ws-B", to: "plan", eventId: "b", recordedAt: 1 }),
			{ rootDir },
		);
		const all = await readAllAgentLedger({ rootDir });
		// Merged across both workspace files, sorted by recordedAt ASC.
		expect(all.map((event) => event.eventId)).toEqual(["b", "a"]);
	});
});
