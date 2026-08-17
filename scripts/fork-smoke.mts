/**
 * §dsh#32 — FORK end-to-end smoke: the acp-smoke rig (sim + isolated HOME + `nklein acp` child) runs one
 * card to end_turn, then calls `runtime.forkTaskSession` over tRPC and requires: forked=true at a sane
 * boundary AND a persisted transcript for the FORK id whose message count exceeds the boundary (the fork
 * actually ran turns from the inherited context). Proves core → seam → contract → router live.
 */

import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import { ClientSideConnection, ndJsonStream, type SessionNotification } from "@agentclientprotocol/sdk";
import type { ScenarioScript } from "../packages/llm-simulator/src/scenario/track-types";
import { createSimulatorServer } from "../packages/llm-simulator/src/server";
import { globSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);
const REPO = process.cwd();
const SIM_MODEL = "sim/soak-coder";

function smokeScript(): ScenarioScript {
	return {
		name: "acp-smoke",
		seed: 13,
		tracks: [
			{
				id: "acp-worker",
				requestClass: "worker",
				cycleTurns: true,
				turns: [
					{
						behavior: {
							kind: "tool_calls",
							calls: [
								{
									name: "write_files",
									arguments: {
										files: [
											{ path: "acp-note.md", content: "ACP smoke note.\n" },
											{
												path: "acp-note.test.js",
												content:
													"const test = require('node:test');\nconst assert = require('node:assert');\ntest('note exists', () => { assert.ok(true); });\n",
											},
										],
									},
								},
							],
						},
					},
					{ behavior: { kind: "text", content: "Wrote the note and its covering test." } },
				],
			},
			{
				id: "acp-review",
				requestClass: "review",
				cycleTurns: true,
				turns: [
					{
						behavior: {
							kind: "tool_calls",
							calls: [
								{ name: "submit_review", arguments: { verdict: "approve", summary: "ACP smoke: note + test present." } },
							],
						},
					},
					{ behavior: { kind: "text", content: "Review submitted." } },
				],
			},
			{
				id: "acp-any",
				requestClass: "any",
				repeatLastTurn: true,
				turns: [{ behavior: { kind: "text", content: "Acknowledged." } }],
			},
		],
	};
}

const work = await realpath(await mkdtemp(join(tmpdir(), "fork-smoke-")));
const home = join(work, "home");
const workspace = join(work, "ws");
await mkdir(join(home, ".nklein", "nklein"), { recursive: true });
await mkdir(join(home, ".nklein", "data", "settings"), { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(
	join(workspace, "package.json"),
	`${JSON.stringify({ name: "acp-ws", private: true, scripts: { test: "node --test" } }, null, 1)}\n`,
);
await writeFile(join(workspace, "README.md"), "acp smoke workspace\n");
const git = (...args: string[]) => execFileAsync("git", ["-C", workspace, ...args]);
await git("init", "--quiet", "--initial-branch=main");
await git("add", "-A");
await git("-c", "user.email=acp@local", "-c", "user.name=acp", "commit", "-qm", "init");

const simulator = createSimulatorServer(smokeScript(), {
	models: [{ id: SIM_MODEL, state: "loaded", family: "qwen", maxContextLength: 65536 }],
});
await simulator.start();
const simBase = simulator.url();
process.stdout.write(`fork-smoke simulator: ${simBase}\n`);

await writeFile(
	join(home, ".nklein", "nklein", "config.json"),
	JSON.stringify(
		{
			selectedAgentId: "nklein",
			developerModeEnabled: true,
			setupWizardCompletedAt: Date.now(),
			agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "fully_open" } },
			modelRoles: {
				architect: { modelId: SIM_MODEL, providerId: "lmstudio" },
				worker: { modelId: SIM_MODEL, providerId: "lmstudio" },
				reviewer: { modelId: SIM_MODEL, providerId: "lmstudio" },
			},
		},
		null,
		1,
	),
);
await writeFile(
	join(home, ".nklein", "nklein", "nklein-provider-selection.json"),
	`${JSON.stringify({ providerId: "lmstudio" }, null, 2)}\n`,
);
await writeFile(
	join(home, ".nklein", "data", "settings", "providers.json"),
	JSON.stringify(
		{
			version: 1,
			lastUsedProvider: "lmstudio",
			providers: {
				lmstudio: {
					settings: { provider: "lmstudio", model: SIM_MODEL, baseUrl: simBase },
					updatedAt: new Date().toISOString(),
					tokenSource: "manual",
				},
			},
		},
		null,
		1,
	),
);

let child: ChildProcess | null = null;
const shutdown = async (): Promise<void> => {
	child?.kill("SIGTERM");
	await new Promise((tick) => setTimeout(tick, 2_000));
	if (child && child.exitCode === null) {
		child.kill("SIGKILL");
	}
	await simulator.stop().catch(() => undefined);
	await rm(work, { recursive: true, force: true });
};

try {
	process.stdout.write("spawning `nklein acp` (editor-style, stdio)…\n");
	child = spawn(join(REPO, "node_modules", ".bin", "tsx"), ["src/cli.ts", "acp"], {
		cwd: REPO,
		env: { ...process.env, HOME: home, NODE_ENV: "development", NKLEIN_RUNTIME_PORT: "3498", NKLEIN_INTERNAL_AUTH_TOKEN: "fork-smoke-token" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
	if (!child.stdin || !child.stdout) {
		throw new Error("child stdio not piped");
	}
	const stream = ndJsonStream(
		Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
		Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
	);
	const updates: SessionNotification[] = [];
	const client = new ClientSideConnection(
		() => ({
			requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
			sessionUpdate: async (params: SessionNotification) => {
				updates.push(params);
				const update = params.update as { content?: { text?: string } };
				process.stdout.write(`  update: ${update.content?.text ?? JSON.stringify(params.update).slice(0, 80)}\n`);
			},
		}),
		stream,
	);

	const init = await client.initialize({ protocolVersion: 1, clientCapabilities: {} });
	process.stdout.write(`initialize → v${init.protocolVersion} (${init.agentInfo?.name})\n`);
	const session = await client.newSession({ cwd: workspace, mcpServers: [] });
	process.stdout.write(`session/new → ${session.sessionId}\n`);
	const response = await client.prompt({
		sessionId: session.sessionId,
		prompt: [{ type: "text", text: "Write acp-note.md with one line and a covering test." }],
	});
	process.stdout.write(`session/prompt → stopReason=${response.stopReason} after ${updates.length} update(s)\n`);
	if (response.stopReason !== "end_turn") {
		throw new Error(`prompt did not end_turn (${response.stopReason})`);
	}

	// ── the FORK step ──
	const sessionFiles = globSync(join(home, ".nklein", "data", "sessions", "*", "*.messages.json"));
	const transcripts = sessionFiles
		.map((file) => JSON.parse(readFileSync(file, "utf8")) as { sessionId?: string; messages?: unknown[] })
		.filter((doc) => typeof doc.sessionId === "string" && !doc.sessionId.includes("::review"));
	const source = transcripts.sort((a, b) => (b.messages?.length ?? 0) - (a.messages?.length ?? 0))[0];
	if (!source?.sessionId) {
		throw new Error("no worker transcript found to fork");
	}
	const sourceTaskId = source.sessionId.replace(/-\d{13}-[a-z0-9]+$/i, "");
	process.stdout.write(`forking source task ${sourceTaskId} (transcript ${source.messages?.length} messages)\n`);
	process.env.NKLEIN_RUNTIME_PORT = "3498";
	process.env.NKLEIN_INTERNAL_AUTH_TOKEN = "fork-smoke-token";
	const { createDevRuntimeClient } = await import("../src/commands/dev-project-execution");
	// The workspace registry lives in the CHILD's isolated HOME — derive the id from its workspaces dir
	// rather than resolving through this process's own HOME.
	const workspaceDirs = globSync(join(home, ".nklein", "nklein", "workspaces", "*", "board.json"));
	const workspaceId = workspaceDirs[0]?.split("/").at(-2);
	if (!workspaceId) {
		throw new Error("no workspace dir found in the child HOME");
	}
	const rpc = createDevRuntimeClient(workspaceId);
	const forkTaskId = `${sourceTaskId}-fork1`;
	const forkResponse = await rpc.runtime.forkTaskSession.mutate({
		sourceTaskId,
		forkTaskId,
		prompt: "Reword acp-note.md to two lines; keep the covering test green.",
	});
	process.stdout.write(`forkTaskSession → ${JSON.stringify(forkResponse)}\n`);
	if (!forkResponse.forked || forkResponse.boundaryIndex === null) {
		throw new Error(`fork refused: ${forkResponse.refusalKind}`);
	}
	// The fork must RUN: within 60s a persisted transcript for the fork id must exceed the boundary prefix.
	let forkRan = false;
	for (let attempt = 0; attempt < 30; attempt++) {
		await new Promise((tick) => setTimeout(tick, 2_000));
		const forkFiles = globSync(join(home, ".nklein", "data", "sessions", "*", "*.messages.json")).filter((file) =>
			file.includes(forkTaskId),
		);
		const counts = forkFiles.map(
			(file) => (JSON.parse(readFileSync(file, "utf8")) as { messages?: unknown[] }).messages?.length ?? 0,
		);
		if (counts.some((count) => count > (forkResponse.boundaryIndex as number) + 1)) {
			forkRan = true;
			break;
		}
	}
	process.stdout.write(forkRan ? "FORK SMOKE PASS\n" : "FORK SMOKE FAIL (fork never advanced past the boundary)\n");
	process.exitCode = forkRan ? 0 : 1;
} finally {
	await shutdown();
}
