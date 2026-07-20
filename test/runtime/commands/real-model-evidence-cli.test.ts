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
		const ledgers = join(home, ".nklein", "nklein", "agent-attempt-ledger");
		const workspace = join(home, ".nklein", "nklein", "workspaces", "workspace-1");
		await Promise.all([
			mkdir(sessions, { recursive: true }),
			mkdir(ledgers, { recursive: true }),
			mkdir(workspace, { recursive: true }),
		]);
		await writeFile(
			join(sessions, "session-1.messages.json"),
			JSON.stringify({
				sessionId: "session-1",
				messages: [
					{
						id: "assistant",
						ts: 1,
						content: [
							{ type: "tool_use", id: "failed", name: "decompose_project", input: { tasks: [] } },
							{ type: "tool_use", id: "pending", name: "submit_plan_critique", input: {} },
						],
					},
					{
						id: "result",
						ts: 2,
						content: [
							{
								type: "tool_result",
								tool_use_id: "failed",
								is_error: true,
								content: { error: "missing implementation dependency" },
							},
						],
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
		await writeFile(runtimeLog, "plan-critique is waiting for capacity at its 1 concurrent-session cap\n", "utf8");

		const summary = await collectRealModelRunEvidence({
			homeDir: home,
			outputDir: output,
			runtimeLogPath: runtimeLog,
		});

		expect(summary).toMatchObject({
			sessions: 1,
			toolUses: 2,
			errorResults: 1,
			pendingToolUses: 1,
			transitions: 1,
			boards: 1,
			runtimeSignals: 1,
			collectionErrors: [],
		});
		const toolErrors = (await readFile(join(output, "tool-errors.jsonl"), "utf8")).trim().split("\n");
		expect(JSON.parse(toolErrors[0] ?? "{}")).toMatchObject({
			toolName: "decompose_project",
			isError: true,
			result: { error: "missing implementation dependency" },
		});
		expect(await readFile(join(output, "pending-tool-uses.jsonl"), "utf8")).toContain("submit_plan_critique");
		expect(await readFile(join(output, "card-transitions.jsonl"), "utf8")).toContain('"to":"running"');
		expect(await readFile(join(output, "runtime-signals.jsonl"), "utf8")).toContain('"kind":"model_capacity_wait"');
	});
});
