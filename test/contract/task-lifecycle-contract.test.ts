/**
 * Suite 3 — CLI task lifecycle → WS board events contract (todo §5.V)
 *
 * The CLI task CRUD itself is covered exhaustively by Suite 12 (cli-task-subcommands), and the WS
 * `workspace_state_updated` push on a tRPC mutation (+ per-project isolation) by the runtime-state-stream
 * integration test. The one seam neither covers is the CHAIN between them: a board mutation that originates
 * from the `nklein task` CLI must still reach a subscribed WS client as a board event. That's the real risk
 * here — a CLI persistence path that writes board state WITHOUT going through the broadcast hook would leave
 * the live UI stale. These tests subscribe to the runtime state stream, drive the CLI as a black-box
 * subprocess, and assert the resulting board event arrives over the socket.
 *
 * Port-resilient: own free port + real TS backend. Hermetic: isolated HOME + temp workspaces.
 * Language-agnostic: asserts the raw WS JSON contract, not TypeScript internals.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RuntimeStateStreamMessage, RuntimeStateStreamWorkspaceStateMessage } from "../../src/core/api-contract";
import { createGitTestEnv } from "../utilities/git-env";
import type { BackendUnderTest } from "./helpers";
import { connectRuntimeStream, getAvailablePort, initGitRepository, requestJson, startTsBackend } from "./helpers";

const requireFromHere = createRequire(import.meta.url);

interface CliResult {
	status: number | null;
	stdout: string;
	stderr: string;
	json: Record<string, unknown> | null;
}

/** Spawn `nklein task <subcommand>` as a black box (mirrors Suite 12's helper, trimmed). */
function spawnTask(subcommand: string, options: { args?: string[]; homeDir: string; port: number }): CliResult {
	const { args = [], homeDir, port } = options;
	const env: NodeJS.ProcessEnv = {
		...createGitTestEnv({ HOME: homeDir, USERPROFILE: homeDir, KANBAN_RUNTIME_PORT: String(port) }),
		TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json"),
		// Keep the core-py sidecar out of contract runs.
		NKLEIN_CORE_PY: "0",
	};
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			pathToFileURL(requireFromHere.resolve("tsx")).href,
			resolve(process.cwd(), "src/cli.ts"),
			"task",
			subcommand,
			...args,
		],
		{ env, encoding: "utf8", timeout: 30_000 },
	);
	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		// Non-JSON output is fine for some commands.
	}
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

async function addSelfProject(baseUrl: string, cwdPath: string): Promise<string> {
	const res = await requestJson<{ ok: boolean; project: { id: string } | null }>({
		baseUrl,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!res.payload.ok || !res.payload.project) {
		throw new Error(`Failed to register project: ${JSON.stringify(res.payload)}`);
	}
	return res.payload.project.id;
}

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function cardIdsOnBoard(message: RuntimeStateStreamWorkspaceStateMessage): string[] {
	return message.workspaceState.board.columns.flatMap((column) => column.cards.map((card) => card.id));
}

function columnOfCard(message: RuntimeStateStreamWorkspaceStateMessage, cardId: string): string | null {
	for (const column of message.workspaceState.board.columns) {
		if (column.cards.some((card) => card.id === cardId)) {
			return column.id;
		}
	}
	return null;
}

describe.sequential("Suite 3 — CLI task mutation → WS board event", () => {
	let server: BackendUnderTest;
	let projectDir: string;
	let serverCwd: string;
	let homeDir: string;
	let port: number;
	let workspaceId: string;

	beforeAll(async () => {
		// projectDir = the workspace the CLI targets; serverCwd = a SEPARATE git root for the server, so
		// registering projectDir doesn't trip the "self-project needs confirmation" guard.
		projectDir = makeTempDir("kanban-task-ws-proj-");
		serverCwd = makeTempDir("kanban-task-ws-svc-");
		homeDir = makeTempDir("kanban-task-ws-home-");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(serverCwd, { recursive: true });
		initGitRepository(projectDir);
		initGitRepository(serverCwd);

		port = await getAvailablePort();
		server = await startTsBackend({ cwd: serverCwd, homeDir, port });
		workspaceId = await addSelfProject(server.baseUrl, projectDir);
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(projectDir);
		cleanupDir(serverCwd);
		cleanupDir(homeDir);
	});

	function wsUrl(): string {
		return `ws://${new URL(server.baseUrl).host}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`;
	}

	const isWorkspaceUpdate = (message: RuntimeStateStreamMessage): message is RuntimeStateStreamWorkspaceStateMessage =>
		message.type === "workspace_state_updated" && message.workspaceId === workspaceId;

	it("a CLI `task create` pushes a workspace_state_updated event carrying the new card in Backlog", async () => {
		const stream = await connectRuntimeStream(wsUrl());
		try {
			// Drain the initial snapshot so we only assert on the post-create event.
			await stream.waitForMessage((message) => message.type === "snapshot", 8_000);

			const created = spawnTask("create", {
				args: ["--prompt", "WS event task body", "--title", "WS Event Card", "--project-path", projectDir],
				homeDir,
				port,
			});
			expect(created.status).toBe(0);
			const cardId = (created.json?.task as { id?: string } | undefined)?.id;
			expect(typeof cardId).toBe("string");

			// waitForMessage returns the wide union; the type guard guarantees the variant, so narrow it (the
			// established `as` convention for this helper — see runtime-state-stream.integration.test.ts).
			const event = (await stream.waitForMessage(
				isWorkspaceUpdate,
				8_000,
			)) as RuntimeStateStreamWorkspaceStateMessage;
			expect(cardIdsOnBoard(event)).toContain(cardId);
			expect(columnOfCard(event, cardId as string)).toBe("backlog");
		} finally {
			await stream.close();
		}
	}, 30_000);

	it("a CLI `task done` pushes a board event moving the card to Completed", async () => {
		// Seed a card first (its create event is irrelevant to this assertion).
		const created = spawnTask("create", {
			args: ["--prompt", "to be completed", "--title", "Done Me", "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(created.status).toBe(0);
		const cardId = (created.json?.task as { id?: string } | undefined)?.id as string;
		expect(typeof cardId).toBe("string");

		const stream = await connectRuntimeStream(wsUrl());
		try {
			await stream.waitForMessage((message) => message.type === "snapshot", 8_000);

			const done = spawnTask("done", { args: ["--task-id", cardId, "--project-path", projectDir], homeDir, port });
			expect(done.status).toBe(0);

			const event = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamWorkspaceStateMessage =>
					isWorkspaceUpdate(message) && columnOfCard(message, cardId) === "completed",
				8_000,
			)) as RuntimeStateStreamWorkspaceStateMessage;
			expect(columnOfCard(event, cardId)).toBe("completed");
		} finally {
			await stream.close();
		}
	}, 30_000);
});
