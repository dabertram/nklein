import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTerminalAttemptEvent } from "../../src/nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent } from "../../src/state/agent-attempt-ledger-store";
import {
	persistModelBehaviorOutcome,
	readAllCombinedModelBehaviorProfiles,
	readAllModelBehaviorProfiles,
	readCombinedModelBehaviorProfile,
	readModelBehaviorProfile,
} from "../../src/telemetry/model-behavior-profile-store";

describe("model-behavior-profile-store (§5.AA persistence)", () => {
	let rootDir: string;
	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-mbp-"));
	});
	afterEach(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});

	it("empty store ⇒ an empty profile (never throws on a missing dir)", async () => {
		const profile = await readModelBehaviorProfile("prov:model:default", { rootDir: `${rootDir}/does-not-exist` });
		expect(profile.samples).toBe(0);
		expect(profile.successRate).toBe(0);
	});

	it("folds appended outcomes into the learned profile (samples/successes/failure modes)", async () => {
		const key = "prov:coder:default";
		await persistModelBehaviorOutcome(
			key,
			{ kind: "success", retries: 0, toolCallFormat: "native" },
			{ rootDir, now: 1_000 },
		);
		await persistModelBehaviorOutcome(key, { kind: "no_tool_call", retries: 1 }, { rootDir, now: 2_000 });
		await persistModelBehaviorOutcome(
			key,
			{ kind: "success", retries: 0, toolCallFormat: "native" },
			{ rootDir, now: 3_000 },
		);

		const profile = await readModelBehaviorProfile(key, { rootDir });
		expect(profile.samples).toBe(3);
		expect(profile.successes).toBe(2);
		expect(profile.failureModes.no_tool_call).toBe(1);
		expect(profile.toolCallFormatCounts.native).toBe(2); // counted on SUCCESS only
		// EWMA (alpha 0.3): 1 → 0.7 → 0.79
		expect(profile.successRate).toBeCloseTo(0.79, 5);
		expect(profile.updatedAt).toBe(3_000); // stamped at the LAST outcome
	});

	it("keeps models isolated + readAll returns one profile per model", async () => {
		await persistModelBehaviorOutcome("prov:a:default", { kind: "success" }, { rootDir, now: 10 });
		await persistModelBehaviorOutcome("prov:b:default", { kind: "timeout" }, { rootDir, now: 20 });
		await persistModelBehaviorOutcome("prov:b:default", { kind: "timeout" }, { rootDir, now: 30 });

		const all = await readAllModelBehaviorProfiles({ rootDir });
		expect(Object.keys(all).sort()).toEqual(["prov:a:default", "prov:b:default"]);
		expect(all["prov:a:default"].successes).toBe(1);
		expect(all["prov:b:default"].failureModes.timeout).toBe(2);
		expect(all["prov:b:default"].successes).toBe(0);
	});

	it("folds OLDEST-FIRST regardless of append order (EWMA is order-dependent)", async () => {
		// Append the NEWER outcome first, then the older — the fold must still replay oldest→newest.
		const key = "prov:reasoner:default";
		await persistModelBehaviorOutcome(key, { kind: "success" }, { rootDir, now: 5_000 });
		await persistModelBehaviorOutcome(key, { kind: "no_tool_call" }, { rootDir, now: 1_000 });
		const profile = await readModelBehaviorProfile(key, { rootDir });
		// oldest = no_tool_call (isFirst → rate 0), then success → 0*(0.7)+1*0.3 = 0.3
		expect(profile.successRate).toBeCloseTo(0.3, 5);
		expect(profile.updatedAt).toBe(5_000);
	});

	it("skips corrupt / non-matching lines defensively", async () => {
		const key = "prov:c:default";
		await persistModelBehaviorOutcome(key, { kind: "success" }, { rootDir, now: 100 });
		// Inject junk into the same day's file.
		const day = new Date(100).toISOString().slice(0, 10);
		await writeFile(
			join(rootDir, `${day}.jsonl`),
			`not json\n{"bad":true}\n${JSON.stringify({ modelId: key, recordedAt: 200, outcome: { kind: "success" } })}\n`,
			{ flag: "a" },
		);
		const profile = await readModelBehaviorProfile(key, { rootDir });
		expect(profile.samples).toBe(2); // the original + the one valid appended line; junk dropped
	});

	it("ignores a blank modelId (no write)", async () => {
		await persistModelBehaviorOutcome("   ", { kind: "success" }, { rootDir, now: 1 });
		const all = await readAllModelBehaviorProfiles({ rootDir });
		expect(Object.keys(all)).toHaveLength(0);
	});

	it("F1.15d: the combined read folds persisted outcomes + ledger BOARD attempts chronologically", async () => {
		const ledgerDir = join(rootDir, "ledger");
		// Persisted (pre-cutover history): one failure at t=1000.
		await persistModelBehaviorOutcome("prov:model:default", { kind: "other_failure" }, { rootDir, now: 1_000 });
		// Ledger: a post-cutover board success at t=2000 (difficulty stamped), a chat attempt (excluded), and a
		// pre-cutover board attempt without difficulty (excluded — the store already carries that history).
		const board = buildTerminalAttemptEvent({
			taskId: "t-1",
			workspacePath: "/repo",
			state: "awaiting_review",
			role: "worker",
			providerId: "",
			modelId: "",
			endpoint: "",
			startedAt: 1_500,
			endedAt: 2_000,
			promptTokens: null,
			completionTokens: null,
			timeoutReason: null,
			difficulty: "medium",
		});
		const aligned = { ...board, modelId: "prov:model:default", recordedAt: 2_000 };
		await appendAgentLedgerEvent(aligned, { rootDir: ledgerDir });
		await appendAgentLedgerEvent(
			{ ...aligned, attemptId: "chat-1", flow: "chat", recordedAt: 3_000 },
			{ rootDir: ledgerDir },
		);
		await appendAgentLedgerEvent(
			{ ...aligned, attemptId: "legacy-1", difficulty: null, recordedAt: 500 },
			{ rootDir: ledgerDir },
		);

		const combined = await readCombinedModelBehaviorProfile("prov:model:default", {
			rootDir,
			ledgerRootDir: ledgerDir,
		});
		expect(combined.samples).toBe(2); // persisted failure + the ONE cutover-eligible ledger success
		// Store-only fold sees just the persisted failure — the combined read is strictly additive.
		const storeOnly = await readModelBehaviorProfile("prov:model:default", { rootDir });
		expect(storeOnly.samples).toBe(1);
		const all = await readAllCombinedModelBehaviorProfiles({ rootDir, ledgerRootDir: ledgerDir });
		expect(all["prov:model:default"]?.samples).toBe(2);
	});
});
