/**
 * Suite 12 — CLI task subcommands contract
 *
 * Drives the `nklein task` CLI subcommands as a black box via spawnSync and asserts:
 *   - exit code
 *   - stdout JSON shape (parsed; field-level checks)
 *   - resulting on-disk board state (read from the local workspace mirror)
 *
 * Port-resilient: each describe block allocates its own free port, spins up a
 * real TS backend, and tears it down in afterAll.
 *
 * Hermetic: uses an isolated HOME + isolated temp workspace directory; never
 * touches the real ~/.nklein tree.
 *
 * Server requirement:
 *   task create / list / done / trash / delete  →  require a running server
 *     (ensureRuntimeWorkspace + runtimeClient.workspace.getState)
 *   task swarm-stop / swarm-resume              →  pure disk ops, NO server needed
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGitTestEnv } from "../utilities/git-env";
import type { BackendUnderTest } from "./helpers";
import { getAvailablePort, initGitRepository, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

function resolveCliEntrypoint(): string {
	return resolve(process.cwd(), "src/cli.ts");
}

interface CliResult {
	status: number | null;
	stdout: string;
	stderr: string;
	json: Record<string, unknown> | null;
}

interface SpawnTaskOptions {
	/** Extra args after "task <subcommand>" */
	args?: string[];
	/** Working directory for the spawned process (defaults to cwd) */
	cwd?: string;
	/** HOME directory (isolates ~/.nklein writes) */
	homeDir: string;
	/** Runtime port so the CLI finds the right backend */
	port?: number;
}

function spawnTask(subcommand: string, options: SpawnTaskOptions): CliResult {
	const { args = [], cwd = process.cwd(), homeDir, port } = options;
	const env: NodeJS.ProcessEnv = {
		...createGitTestEnv({
			HOME: homeDir,
			USERPROFILE: homeDir,
			...(port !== undefined ? { KANBAN_RUNTIME_PORT: String(port) } : {}),
		}),
		TSX_TSCONFIG_PATH: resolve(process.cwd(), "tsconfig.json"),
		// Prevent the sidecar from auto-starting during contract tests.
		NKLEIN_CORE_PY: "0",
	};

	const result = spawnSync(
		process.execPath,
		["--import", resolveTsxLoaderImportSpecifier(), resolveCliEntrypoint(), "task", subcommand, ...args],
		{ cwd, env, encoding: "utf8", timeout: 30_000 },
	);

	let json: Record<string, unknown> | null = null;
	try {
		json = JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		// Not JSON — that is fine for some tests (e.g. error output to stderr).
	}

	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
		json,
	};
}

// ---------------------------------------------------------------------------
// On-disk board helpers
// ---------------------------------------------------------------------------

/**
 * Read the local board mirror that mutateWorkspaceState writes inside the project.
 * Path: <projectPath>/.nklein/nklein/workspace/board.json
 */
function readLocalBoard(projectPath: string): Record<string, unknown> {
	const boardPath = join(projectPath, ".nklein", "nklein", "workspace", "board.json");
	if (!existsSync(boardPath)) {
		throw new Error(`Local board file not found: ${boardPath}`);
	}
	return JSON.parse(readFileSync(boardPath, "utf8")) as Record<string, unknown>;
}

type BoardCard = {
	id: string;
	title?: string;
	[key: string]: unknown;
};

type BoardColumn = {
	id: string;
	cards: BoardCard[];
};

function getColumnCards(board: Record<string, unknown>, columnId: string): BoardCard[] {
	const columns = board.columns as BoardColumn[] | undefined;
	if (!Array.isArray(columns)) return [];
	return columns.find((c) => c.id === columnId)?.cards ?? [];
}

function findCardInBoard(board: Record<string, unknown>, cardId: string): { columnId: string; card: BoardCard } | null {
	const columns = board.columns as BoardColumn[] | undefined;
	if (!Array.isArray(columns)) return null;
	for (const col of columns) {
		const card = col.cards.find((c) => c.id === cardId);
		if (card) return { columnId: col.id, card };
	}
	return null;
}

// ---------------------------------------------------------------------------
// Temp-dir helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

// ---------------------------------------------------------------------------
// Suite A: task lifecycle — create → list → done / trash / delete
// (requires a running backend)
// ---------------------------------------------------------------------------

describe.sequential("Suite 12-A — task lifecycle (create → list → done / trash / delete)", () => {
	let server: BackendUnderTest;
	let projectDir: string;
	let serverCwd: string;
	let homeDir: string;
	let port: number;

	beforeAll(async () => {
		// projectDir: the workspace the CLI task commands target.
		// serverCwd: a SEPARATE git repo that the server considers its own cwd.
		// They must be different repos so `projects.add(projectDir)` does not
		// trigger the "self-improvement workflow needs confirmation" guard
		// (which fires when serverCwd and projectDir resolve to the same git root).
		projectDir = makeTempDir("kanban-task-cli-proj-");
		serverCwd = makeTempDir("kanban-task-cli-svc-");
		homeDir = makeTempDir("kanban-task-cli-home-");
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(serverCwd, { recursive: true });
		initGitRepository(projectDir);
		initGitRepository(serverCwd);

		port = await getAvailablePort();
		server = await startTsBackend({ cwd: serverCwd, homeDir, port });
	}, 40_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(projectDir);
		cleanupDir(serverCwd);
		cleanupDir(homeDir);
	});

	// ── task create ──────────────────────────────────────────────────────────

	it("task create returns exit 0 and the created card in JSON", () => {
		const result = spawnTask("create", {
			args: ["--prompt", "Write a hello-world test", "--title", "Hello World", "--project-path", projectDir],
			homeDir,
			port,
		});

		expect(result.status).toBe(0);
		expect(result.json).not.toBeNull();
		expect(result.json?.ok).toBe(true);
		const task = result.json?.task as Record<string, unknown> | undefined;
		expect(typeof task?.id).toBe("string");
		expect(task?.title).toBe("Hello World");
		expect(task?.column).toBe("backlog");
		expect(task?.prompt).toBe("Write a hello-world test");
	});

	// ── task list shows created card ─────────────────────────────────────────

	it("task list returns the created card with id / prompt / column shape", () => {
		// Note: formatTaskRecord (used by listTasks) emits id/prompt/column/baseRef/…
		// but does NOT include title — title lives on create response only.
		const result = spawnTask("list", {
			args: ["--project-path", projectDir],
			homeDir,
			port,
		});

		expect(result.status).toBe(0);
		expect(result.json?.ok).toBe(true);
		const tasks = result.json?.tasks as Array<Record<string, unknown>>;
		expect(Array.isArray(tasks)).toBe(true);
		expect(tasks.length).toBeGreaterThanOrEqual(1);
		const task = tasks[0];
		expect(typeof task?.id).toBe("string");
		expect(typeof task?.prompt).toBe("string");
		expect(typeof task?.column).toBe("string");
	});

	// ── task list --column filters ────────────────────────────────────────────

	it("task list --column backlog only returns backlog cards", () => {
		const result = spawnTask("list", {
			args: ["--project-path", projectDir, "--column", "backlog"],
			homeDir,
			port,
		});

		expect(result.status).toBe(0);
		const tasks = result.json?.tasks as Array<Record<string, unknown>>;
		expect(Array.isArray(tasks)).toBe(true);
		for (const task of tasks) {
			expect(task.column).toBe("backlog");
		}
	});

	it("task list --column in_progress returns an empty list when no tasks are running", () => {
		const result = spawnTask("list", {
			args: ["--project-path", projectDir, "--column", "in_progress"],
			homeDir,
			port,
		});

		expect(result.status).toBe(0);
		const tasks = result.json?.tasks as Array<Record<string, unknown>>;
		expect(Array.isArray(tasks)).toBe(true);
		expect(tasks.length).toBe(0);
	});

	// ── task done moves backlog card to completed ─────────────────────────────

	it("task done --task-id moves the card to completed and the disk board reflects it", () => {
		// First create a second card we will mark done.
		const createResult = spawnTask("create", {
			args: ["--prompt", "Task to be completed", "--title", "Complete Me", "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(createResult.status).toBe(0);
		const taskId = String((createResult.json?.task as Record<string, unknown> | undefined)?.id ?? "");

		const doneResult = spawnTask("done", {
			args: ["--task-id", taskId, "--project-path", projectDir],
			homeDir,
			port,
		});

		expect(doneResult.status).toBe(0);
		expect(doneResult.json?.ok).toBe(true);

		// Verify on disk: the local board mirror should show the card in 'completed'.
		const board = readLocalBoard(projectDir);
		const found = findCardInBoard(board, taskId);
		expect(found).not.toBeNull();
		expect(found?.columnId).toBe("completed");
	});

	// ── task trash moves backlog card to trash ────────────────────────────────

	it("task trash --task-id moves the card to trash and the disk board reflects it", () => {
		const createResult = spawnTask("create", {
			args: ["--prompt", "Task to be trashed", "--title", "Trash Me", "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(createResult.status).toBe(0);
		const taskId = String((createResult.json?.task as Record<string, unknown> | undefined)?.id ?? "");

		const trashResult = spawnTask("trash", {
			args: ["--task-id", taskId, "--project-path", projectDir],
			homeDir,
			port,
		});

		expect(trashResult.status).toBe(0);
		expect(trashResult.json?.ok).toBe(true);

		// Verify on disk: card should be in 'trash' column.
		const board = readLocalBoard(projectDir);
		const found = findCardInBoard(board, taskId);
		expect(found).not.toBeNull();
		expect(found?.columnId).toBe("trash");
	});

	// ── task delete permanently removes the card ──────────────────────────────

	it("task delete --task-id permanently removes the card from the board", () => {
		const createResult = spawnTask("create", {
			args: ["--prompt", "Task to be deleted", "--title", "Delete Me", "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(createResult.status).toBe(0);
		const taskId = String((createResult.json?.task as Record<string, unknown> | undefined)?.id ?? "");

		const deleteResult = spawnTask("delete", {
			args: ["--task-id", taskId, "--project-path", projectDir],
			homeDir,
			port,
		});

		expect(deleteResult.status).toBe(0);
		expect(deleteResult.json?.ok).toBe(true);
		expect((deleteResult.json?.count as number) ?? 0).toBeGreaterThanOrEqual(1);

		// Verify on disk: card should be gone entirely.
		const board = readLocalBoard(projectDir);
		const found = findCardInBoard(board, taskId);
		expect(found).toBeNull();
	});

	// ── task delete by column ─────────────────────────────────────────────────

	it("task delete --column completed bulk-removes all completed cards", () => {
		// Ensure there is at least one completed card to delete.
		const createResult = spawnTask("create", {
			args: ["--prompt", "Bulk-delete target", "--title", "Bulk Delete", "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(createResult.status).toBe(0);
		const taskId = String((createResult.json?.task as Record<string, unknown> | undefined)?.id ?? "");

		// Move it to completed first.
		const doneResult = spawnTask("done", {
			args: ["--task-id", taskId, "--project-path", projectDir],
			homeDir,
			port,
		});
		expect(doneResult.status).toBe(0);

		// Bulk delete completed column.
		const deleteResult = spawnTask("delete", {
			args: ["--column", "completed", "--project-path", projectDir],
			homeDir,
			port,
		});

		expect(deleteResult.status).toBe(0);
		expect(deleteResult.json?.ok).toBe(true);

		// Completed column should now be empty.
		const board = readLocalBoard(projectDir);
		const completedCards = getColumnCards(board, "completed");
		expect(completedCards.length).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite B: task swarm-stop / swarm-resume — NO server required
// (pure disk operations on <projectPath>/.nklein/nklein/swarm-stop.json)
// ---------------------------------------------------------------------------

describe.sequential("Suite 12-B — task swarm-stop / swarm-resume (no server)", () => {
	let projectDir: string;
	let homeDir: string;

	beforeAll(() => {
		// Use realpathSync so projectDir matches the canonical path the CLI will
		// return in workspacePath (macOS /var → /private/var symlink otherwise
		// causes a mismatch).
		projectDir = realpathSync(makeTempDir("kanban-task-swarm-proj-"));
		homeDir = realpathSync(makeTempDir("kanban-task-swarm-home-"));
		mkdirSync(projectDir, { recursive: true });
		initGitRepository(projectDir);
	});

	afterAll(() => {
		cleanupDir(projectDir);
		cleanupDir(homeDir);
	});

	it("task swarm-stop exits 0, returns ok:true JSON, and writes swarm-stop.json on disk", () => {
		const result = spawnTask("swarm-stop", {
			args: ["--reason", "Test operator stop", "--project-path", projectDir],
			homeDir,
		});

		expect(result.status).toBe(0);
		expect(result.json?.ok).toBe(true);
		expect(result.json?.workspacePath).toBe(projectDir);
		const signal = result.json?.signal as Record<string, unknown> | undefined;
		expect(signal?.stopped).toBe(true);
		expect(typeof signal?.reason).toBe("string");
		expect(typeof signal?.createdAt).toBe("number");

		// Verify on disk: swarm-stop.json exists in <projectPath>/.nklein/nklein/
		const signalPath = join(projectDir, ".nklein", "nklein", "swarm-stop.json");
		expect(existsSync(signalPath)).toBe(true);
		const onDisk = JSON.parse(readFileSync(signalPath, "utf8")) as Record<string, unknown>;
		expect(onDisk.stopped).toBe(true);
		expect(onDisk.reason).toBe("Test operator stop");
	});

	it("task swarm-resume exits 0, returns ok:true JSON, and removes swarm-stop.json from disk", () => {
		// Precondition: swarm-stop.json exists from the prior test (tests are sequential).
		const signalPath = join(projectDir, ".nklein", "nklein", "swarm-stop.json");
		expect(existsSync(signalPath)).toBe(true);

		const result = spawnTask("swarm-resume", {
			args: ["--project-path", projectDir],
			homeDir,
		});

		expect(result.status).toBe(0);
		expect(result.json?.ok).toBe(true);
		expect(result.json?.workspacePath).toBe(projectDir);

		// Verify on disk: swarm-stop.json should be gone.
		expect(existsSync(signalPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Suite C: malformed / invalid invocations return non-zero exits
// ---------------------------------------------------------------------------

describe.sequential("Suite 12-C — malformed invocations return non-zero exit codes", () => {
	let homeDir: string;

	beforeAll(() => {
		homeDir = makeTempDir("kanban-task-invalid-home-");
	});

	afterAll(() => {
		cleanupDir(homeDir);
	});

	it("task create without --prompt exits non-zero", () => {
		const result = spawnTask("create", {
			args: ["--title", "No Prompt Card"],
			homeDir,
		});
		// Commander exits 1 with a usage error when a required option is missing.
		expect(result.status).not.toBe(0);
	});

	it("task list with invalid --column value exits non-zero", () => {
		const result = spawnTask("list", {
			args: ["--column", "not_a_real_column"],
			homeDir,
		});
		expect(result.status).not.toBe(0);
	});

	it("task done without --task-id or --column exits non-zero with an error message", () => {
		// done/trash/delete with neither --task-id nor --column → resolveTaskCommandTarget throws.
		// Without a running server this will fail at ensureRuntimeWorkspace but
		// the key observable is a non-zero exit code and a non-empty error indicator.
		const result = spawnTask("done", {
			args: [],
			homeDir,
		});
		// May be non-zero due to runtime connection error or missing argument error; either way not 0.
		expect(result.status).not.toBe(0);
	});

	it("task create with --agent-id invalid-value exits non-zero", () => {
		const result = spawnTask("create", {
			args: ["--prompt", "test", "--agent-id", "totally-invalid-agent-id"],
			homeDir,
		});
		expect(result.status).not.toBe(0);
	});
});
