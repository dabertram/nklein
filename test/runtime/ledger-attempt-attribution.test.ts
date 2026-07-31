import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAttributableModelKey, UNRESOLVED_IDENTITY_SEGMENT } from "../../src/core/model-identity";
import { buildTerminalAttemptEvent, hashWorkspacePathForLedger } from "../../src/nklein-agent/nklein-ledger-attempt";
import { buildNKleinModelRegistryKey } from "../../src/nklein-agent/nklein-model-registry-key";
import { agentLedgerLogPath, appendAgentLedgerEvent } from "../../src/state/agent-attempt-ledger-store";

/**
 * An attempt that names no model is refused at the ledger door.
 *
 * ── THE DEFECT, FROM THE LIVE LEDGER (2026-07-31) ──
 * `normalizeModelId("")` returns `"unknown"`, so an attempt recorded without a resolved model produced the
 * perfectly well-formed key `lmstudio:unknown:default` — and then behaved like a real model everywhere
 * downstream, forming its own row in per-model fitness and edit-reliability rollups.
 *
 * **70 of 238 attempts (29%) on the live ledger were unattributable**, carrying **1074 tool calls that belong to
 * other models**. They arrived in bursts with identical timestamps across different workspaces — a restart
 * re-terminating tasks that had already finished — so the same transcript was re-recorded up to 12 times and
 * `retriesBefore` reached 14 on a card that succeeded on its first attempt.
 *
 * **A phantom model with a plausible success rate is worse than a gap, because a gap is visibly a gap.**
 */

const directories: string[] = [];

async function ledgerRoot(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "nklein-attribution-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	for (const directory of directories.splice(0)) {
		await rm(directory, { recursive: true, force: true });
	}
});

/**
 * Built through the REAL production builder, not hand-assembled: the defect is that the builder happily produces
 * a well-formed event from a null model, so a hand-written fixture would be testing the fixture.
 */
function attemptEvent(modelId: string | null, providerId = "lmstudio") {
	return buildTerminalAttemptEvent({
		taskId: "task-1",
		workspacePath: "/repo",
		state: "interrupted",
		role: "worker",
		providerId,
		modelId,
		endpoint: modelId === null ? null : "http://127.0.0.1:1234/v1",
		startedAt: 1_000,
		endedAt: 5_000,
		promptTokens: null,
		completionTokens: null,
		timeoutReason: null,
	});
}

async function lines(rootDir: string): Promise<string[]> {
	const text = await readFile(agentLedgerLogPath(hashWorkspacePathForLedger("/repo"), rootDir), "utf8").catch(
		() => "",
	);
	return text.split("\n").filter((line) => line.trim().length > 0);
}

describe("isAttributableModelKey", () => {
	it("accepts a real key whose endpoint contains colons", () => {
		// The key cannot be split into exactly three parts — the endpoint is a URL. Segment 1 is still the model.
		expect(isAttributableModelKey("lmstudio:qwen/qwen3-8b:http://localhost:1234/v1")).toBe(true);
	});

	it("rejects the sentinel the empty-model path produces", () => {
		expect(buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "", endpoint: "" })).toBe(
			`lmstudio:${UNRESOLVED_IDENTITY_SEGMENT}:default`,
		);
		expect(isAttributableModelKey("lmstudio:unknown:default")).toBe(false);
	});

	it("does NOT reject a key merely because the ENDPOINT is unresolved", () => {
		// Endpoint absence is ordinary; model absence is not. Conflating them would discard real evidence.
		expect(isAttributableModelKey("lmstudio:qwen/qwen3-8b:default")).toBe(true);
	});

	it("does NOT reject a model whose NAME merely contains the sentinel", () => {
		expect(isAttributableModelKey("lmstudio:unknown-arch-7b:default")).toBe(true);
	});
});

describe("appendAgentLedgerEvent — the attribution door", () => {
	it("writes an attempt that names a model", async () => {
		const rootDir = await ledgerRoot();
		await appendAgentLedgerEvent(attemptEvent("qwen/qwen3-8b"), { rootDir });
		expect(await lines(rootDir)).toHaveLength(1);
	});

	it("REFUSES an attempt that names no model", async () => {
		const rootDir = await ledgerRoot();
		await appendAgentLedgerEvent(attemptEvent(null), { rootDir });
		expect(await lines(rootDir), "a phantom model must never reach the durable evidence stream").toEqual([]);
	});

	it("refuses at the DOOR, so no caller can route around it", async () => {
		// The guard is deliberately in the single append function rather than at the one writer that exists today.
		const rootDir = await ledgerRoot();
		await appendAgentLedgerEvent(attemptEvent(null, "openai"), { rootDir });
		await appendAgentLedgerEvent(attemptEvent("   ", "anything"), { rootDir });
		expect(await lines(rootDir)).toEqual([]);
	});

	it("does NOT refuse a non-attempt event, whatever it contains", async () => {
		// The guard is scoped to the stream that is projected PER MODEL. Refusing anything else would lose
		// unrelated evidence, so a scheduler event with no model in sight must still be written.
		const rootDir = await ledgerRoot();
		const attempt = attemptEvent("qwen/qwen3-8b");
		await appendAgentLedgerEvent(
			{
				schemaVersion: attempt.schemaVersion,
				eventId: "sched-1",
				recordedAt: attempt.recordedAt,
				workflowId: attempt.workflowId,
				taskId: attempt.taskId,
				workspacePathHash: attempt.workspacePathHash,
				role: "worker",
				kind: "scheduler",
				event: "lease_acquired",
				leaseId: "lease-1",
				workerId: "worker-1",
				idempotencyKey: null,
				detail: null,
			} as never,
			{ rootDir },
		);
		expect(await lines(rootDir)).toHaveLength(1);
	});
});
