/**
 * P23.5 held-out oracle probe — S09 offline reconciler (project 02).
 *
 * FAIL_TO_PASS. The seams this probe guards are the spec's hardest and the ones a weak build fakes first:
 * idempotent replay, safety-critical divergence held with BOTH versions verbatim (never last-write-wins),
 * sign-offs treated as safety-critical (the spec's pitfall 7), and shuffle determinism (two fixed permutations
 * of the same command set must converge to identical state — no wall-clock ordering).
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const workspace = process.env.NKLEIN_ORACLE_WORKSPACE;
if (!workspace) {
	throw new Error("NKLEIN_ORACLE_WORKSPACE is not set — the oracle runner must provide the workspace under grade.");
}

const reconcilerModule = await import(pathToFileURL(join(workspace, "src/domain/reconciler.ts")).href);
const eventLogModule = await import(pathToFileURL(join(workspace, "src/domain/event-log.ts")).href);

const EPOCH = 1_700_000_000_000;
const clock = { now: () => EPOCH };

function command(input: {
	id: string;
	actor: string;
	stamp: Record<string, number>;
	payload: Record<string, unknown>;
	entity?: string;
	clientCreatedAt?: number;
}) {
	return {
		id: input.id,
		actor: input.actor,
		causalStamp: input.stamp,
		targetEntityId: input.entity ?? "permit-probe-cs",
		targetBaseVersion: 0,
		payload: input.payload,
		clientCreatedAt: input.clientCreatedAt ?? EPOCH,
	};
}

function emptyState() {
	return { entityVersions: {}, acceptedCommands: {} };
}

function replay(commands: readonly ReturnType<typeof command>[]) {
	const log = new eventLogModule.EventLog();
	let state = emptyState();
	const decisions: { commandId: string; status: string }[] = [];
	for (const cmd of commands) {
		const { decision, nextState } = reconcilerModule.reconcileCommand(cmd, state, log, clock);
		state = nextState;
		log.append(cmd, decision);
		decisions.push({ commandId: cmd.id, status: decision.status });
	}
	return { state, decisions };
}

test("oracle: replaying the SAME command twice is idempotent — the version increments once", () => {
	const log = new eventLogModule.EventLog();
	const cmd = command({
		id: "c-1",
		actor: "device-a",
		stamp: { "device-a": 1 },
		payload: { kind: "update-acceptable-entry-conditions", permitId: "permit-probe-cs", conditions: "v1" },
	});
	let state = emptyState();
	const first = reconcilerModule.reconcileCommand(cmd, state, log, clock);
	state = first.nextState;
	log.append(cmd, first.decision);
	const second = reconcilerModule.reconcileCommand(cmd, state, log, clock);
	assert.equal(second.decision.status, "Accepted");
	assert.equal(second.nextState.entityVersions["permit-probe-cs"], state.entityVersions["permit-probe-cs"]);
});

test("oracle: concurrent same-kind safety-critical divergence is HELD with both versions verbatim", () => {
	const log = new eventLogModule.EventLog();
	const versionA = { kind: "update-acceptable-entry-conditions", permitId: "permit-probe-cs", conditions: "O2 >= 19.5" };
	const versionB = { kind: "update-acceptable-entry-conditions", permitId: "permit-probe-cs", conditions: "O2 >= 18.0" };
	const a = command({ id: "c-a", actor: "device-a", stamp: { "device-a": 1 }, payload: versionA });
	const b = command({ id: "c-b", actor: "device-b", stamp: { "device-b": 1 }, payload: versionB });
	let state = emptyState();
	const first = reconcilerModule.reconcileCommand(a, state, log, clock);
	state = first.nextState;
	log.append(a, first.decision);
	const second = reconcilerModule.reconcileCommand(b, state, log, clock);
	assert.equal(second.decision.status, "ConflictHeld");
	const held = [second.decision.conflictingVersionA, second.decision.conflictingVersionB];
	assert.ok(
		held.some((version) => JSON.stringify(version) === JSON.stringify(versionA)) &&
			held.some((version) => JSON.stringify(version) === JSON.stringify(versionB)),
		"BOTH divergent versions must be preserved verbatim — last-write-wins silently loses safety data",
	);
});

test("oracle: sign-offs are safety-critical — concurrent divergent sign-pretask commands are held, not merged", () => {
	const log = new eventLogModule.EventLog();
	const a = command({
		id: "c-sig-a",
		actor: "foreman-a",
		stamp: { "foreman-a": 1 },
		payload: { kind: "sign-pretask", signerId: "foreman-a", planId: "plan-1" },
	});
	const b = command({
		id: "c-sig-b",
		actor: "foreman-b",
		stamp: { "foreman-b": 1 },
		payload: { kind: "sign-pretask", signerId: "foreman-b", planId: "plan-2" },
	});
	let state = emptyState();
	const first = reconcilerModule.reconcileCommand(a, state, log, clock);
	state = first.nextState;
	log.append(a, first.decision);
	const second = reconcilerModule.reconcileCommand(b, state, log, clock);
	assert.equal(second.decision.status, "ConflictHeld", "a sign-off is safety-load-bearing, never a safe merge");
});

test("oracle: shuffle determinism — two fixed permutations converge to identical versions and held-conflict sets", () => {
	const base = [
		command({
			id: "c-1",
			actor: "device-a",
			stamp: { "device-a": 1 },
			payload: { kind: "update-acceptable-entry-conditions", permitId: "p", conditions: "v1" },
		}),
		command({
			id: "c-2",
			actor: "device-a",
			stamp: { "device-a": 2 },
			payload: { kind: "update-acceptable-entry-conditions", permitId: "p", conditions: "v2" },
		}),
		command({
			id: "c-3",
			actor: "device-b",
			stamp: { "device-b": 1 },
			payload: { kind: "update-acceptable-entry-conditions", permitId: "p", conditions: "vX" },
			clientCreatedAt: EPOCH + 40 * 60_000, // skewed wall clock MUST NOT drive ordering
		}),
		command({
			id: "c-4",
			actor: "device-c",
			stamp: { "device-c": 1 },
			payload: { kind: "close-corrective-action", caId: "ca-1", closedBy: "w-sup" },
			entity: "ca-1",
		}),
		command({
			id: "c-5",
			actor: "device-c",
			stamp: { "device-c": 2 },
			payload: { kind: "close-corrective-action", caId: "ca-2", closedBy: "w-sup" },
			entity: "ca-2",
		}),
	];
	const permutationA = [base[0], base[2], base[1], base[4], base[3]] as ReturnType<typeof command>[];
	const permutationB = [base[4], base[3], base[2], base[0], base[1]] as ReturnType<typeof command>[];
	const runA = replay(permutationA);
	const runB = replay(permutationB);
	const canonical = (state: { entityVersions: Record<string, number> }) =>
		JSON.stringify(Object.fromEntries(Object.entries(state.entityVersions).sort()));
	assert.equal(canonical(runA.state), canonical(runB.state), "entity versions must not depend on arrival order");
	const heldSet = (decisions: { commandId: string; status: string }[]) =>
		JSON.stringify(
			decisions
				.filter((decision) => decision.status === "ConflictHeld")
				.map((decision) => decision.commandId)
				.sort(),
		);
	assert.equal(heldSet(runA.decisions), heldSet(runB.decisions), "held conflicts must be order-independent");
});
