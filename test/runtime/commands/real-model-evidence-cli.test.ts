import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRealModelRunEvidence } from "../../../src/commands/real-model-evidence-cli";

describe("real-model evidence collector", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "nklein-real-evidence-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("materializes exact tool errors, pending calls, transitions, boards, and runtime signals", async () => {
		const home = join(root, "home");
		const output = join(root, "evidence");
		const sessions = join(home, ".nklein", "data", "sessions", "session-1");
		const snapshots = join(home, ".nklein", "evidence-session-snapshots");
		const ledgers = join(home, ".nklein", "nklein", "agent-attempt-ledger");
		const workspace = join(home, ".nklein", "nklein", "workspaces", "workspace-1");
		await Promise.all([
			mkdir(sessions, { recursive: true }),
			mkdir(snapshots, { recursive: true }),
			mkdir(ledgers, { recursive: true }),
			mkdir(workspace, { recursive: true }),
		]);
		await writeFile(
			join(sessions, "session-1.messages.json"),
			JSON.stringify({
				sessionId: "session-1",
				messages: [
					{
						id: "seed",
						role: "user",
						content: [{ type: "text", text: "Plan this system with the kanban decomposition tool." }],
					},
					{
						id: "assistant",
						role: "assistant",
						ts: 1,
						modelInfo: { id: "qwen-test" },
						content: [
							{ type: "tool_use", id: "failed", name: "decompose_project", input: { tasks: [] } },
							{ type: "tool_use", id: "nested-failed", name: "run_commands", input: { commands: ["npm test"] } },
							{ type: "tool_use", id: "pending", name: "submit_plan_critique", input: {} },
						],
					},
					{
						id: "result",
						role: "user",
						ts: 2,
						content: [
							{
								type: "tool_result",
								tool_use_id: "failed",
								is_error: true,
								content: { error: "missing implementation dependency" },
							},
							{
								type: "tool_result",
								tool_use_id: "nested-failed",
								content: [{ query: "npm test", success: false, error: "exit 1" }],
							},
						],
					},
				],
			}),
			"utf8",
		);
		await writeFile(
			join(snapshots, "session-2.messages.json"),
			JSON.stringify({
				sessionId: "session-2",
				messages: [
					{
						id: "critic-seed",
						role: "user",
						content: [{ type: "text", text: "You are the second-opinion reviewer for card 1." }],
					},
					{
						id: "critic",
						role: "assistant",
						ts: 3,
						content: [{ type: "tool_use", id: "verdict", name: "submit_plan_critique", input: {} }],
					},
					{
						id: "critic-result",
						role: "user",
						ts: 4,
						content: [{ type: "tool_result", tool_use_id: "verdict", content: { verdict: "revise" } }],
					},
				],
			}),
			"utf8",
		);
		await writeFile(
			join(ledgers, "ledger.jsonl"),
			`${JSON.stringify({ kind: "transition", recordedAt: 10, taskId: "card-1", from: "planning", to: "running" })}\n${JSON.stringify({ kind: "attempt", recordedAt: 11, taskId: "card-1" })}\n`,
			"utf8",
		);
		await writeFile(join(workspace, "board.json"), JSON.stringify({ board: { columns: [] } }), "utf8");
		const runtimeLog = join(root, "runtime.log");
		await writeFile(
			runtimeLog,
			"plan-critique is waiting for capacity at its 1 concurrent-session cap\nCould not auto-start linked task: No native !Klein provider is configured\n",
			"utf8",
		);

		const summary = await collectRealModelRunEvidence({
			homeDir: home,
			outputDir: output,
			runtimeLogPath: runtimeLog,
		});

			expect(summary).toMatchObject({
			sessions: 2,
			toolUses: 4,
			errorResults: 2,
			pendingToolUses: 1,
			transitions: 1,
			boards: 1,
			runtimeSignals: 2,
			aimockRecordedFixtures: 2,
			aimockReplayTracks: 2,
			aimockReplaySessions: 2,
			aimockSupersededSessions: 0,
			collectionErrors: [],
		});
		const toolErrors = (await readFile(join(output, "tool-errors.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(toolErrors).toContainEqual(
			expect.objectContaining({
				toolName: "decompose_project",
				isError: true,
				result: { error: "missing implementation dependency" },
			}),
		);
		expect(toolErrors).toContainEqual(
			expect.objectContaining({
				toolName: "run_commands",
				isError: false,
				effectiveError: true,
				errorSource: "nested_result",
			}),
		);
		expect(await readFile(join(output, "pending-tool-uses.jsonl"), "utf8")).toContain("submit_plan_critique");
		expect(await readFile(join(output, "card-transitions.jsonl"), "utf8")).toContain('"to":"running"');
		expect(await readFile(join(output, "runtime-signals.jsonl"), "utf8")).toContain('"kind":"model_capacity_wait"');
		expect(await readFile(join(output, "runtime-signals.jsonl"), "utf8")).toContain('"kind":"auto_start_failure"');
		expect(await readFile(join(output, "tool-executions.jsonl"), "utf8")).toContain("submit_plan_critique");
		const fixtures = JSON.parse(await readFile(join(output, "aimock-recorded-fixtures.json"), "utf8"));
		expect(fixtures.fixtures).toHaveLength(2);
		expect(fixtures.fixtures[0]).toMatchObject({
			match: { model: "qwen-test", turnIndex: 0, context: "persisted-session:session-1;class:decompose" },
			response: { toolCalls: expect.arrayContaining([expect.objectContaining({ name: "decompose_project" })]) },
		});
		const replay = JSON.parse(await readFile(join(output, "aimock-replay.json"), "utf8"));
		expect(replay.tracks).toHaveLength(2);
		expect(replay.tracks.map((track: { requestClass: string }) => track.requestClass).sort()).toEqual([
			"any",
			"review",
		]);
	});

	it("keeps all retry fixtures but selects one most-complete transcript per executable replay key", async () => {
		const home = join(root, "retry-home");
		const output = join(root, "retry-evidence");
		const sessions = join(home, ".nklein", "data", "sessions");
		await Promise.all([mkdir(join(sessions, "attempt-a"), { recursive: true }), mkdir(join(sessions, "attempt-b"), { recursive: true })]);
		const seed = { role: "user", content: [{ type: "text", text: "Guidance topic: ts\n\nImplement the retry-safe worker." }] };
		await writeFile(
			join(sessions, "attempt-a", "attempt-a.messages.json"),
			JSON.stringify({
				sessionId: "attempt-a",
				messages: [seed, { role: "assistant", content: [{ type: "text", text: "older short attempt" }] }],
			}),
			"utf8",
		);
		await writeFile(
			join(sessions, "attempt-b", "attempt-b.messages.json"),
			JSON.stringify({
				sessionId: "attempt-b",
				messages: [
					seed,
					{
						role: "assistant",
						content: [{ type: "tool_use", id: "edit", name: "write_file", input: { path: "worker.ts" } }],
					},
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "edit", content: "ok" }] },
					{ role: "assistant", content: [{ type: "text", text: "new complete attempt" }] },
				],
			}),
			"utf8",
		);

		const summary = await collectRealModelRunEvidence({ homeDir: home, outputDir: output, runtimeLogPath: null });
		expect(summary).toMatchObject({
			sessions: 2,
			aimockRecordedFixtures: 3,
			aimockReplayTracks: 2,
			aimockReplaySessions: 1,
			aimockSupersededSessions: 1,
		});
		const replay = JSON.parse(await readFile(join(output, "aimock-replay.json"), "utf8"));
		expect(JSON.stringify(replay)).toContain("new complete attempt");
		expect(JSON.stringify(replay)).not.toContain("older short attempt");
		const manifest = JSON.parse(await readFile(join(output, "aimock-replay-manifest.json"), "utf8"));
		expect(manifest[0]).toMatchObject({
			selectedSessionId: "attempt-b",
			supersededSessionIds: ["attempt-a"],
		});
	});
});
