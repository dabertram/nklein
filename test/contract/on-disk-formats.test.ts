/**
 * Suite 6 — on-disk format parity (§5.V)
 *
 * Pins the raw JSON structures written to disk as the cross-language convergence point.
 * A Python backend writing identical JSON to the same paths must pass these tests.
 *
 * No server is spawned. Tests use temp HOME dirs and temp repo dirs only.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// self-observation-sink must be mocked before importing workspace-state, which calls it on every
// workspace resolution. The mock must be hoisted so vitest processes it before the module graph loads.
const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
}));
vi.mock("../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
}));

import { spawnSync } from "node:child_process";
import { nkleinPlanTaskGraphSchema, readNKleinPlanArtifacts } from "../../src/nklein-agent/nklein-plan-artifacts";
import {
	boardToPortableBoardCrdt,
	CURRENT_PORTABLE_BOARD_SCHEMA_VERSION,
	migratePortableBoardCrdt,
	type PortableBoardCrdtMigration,
} from "../../src/state/portable-board-crdt";
import {
	getPortableBoardCrdtPath,
	readPortableBoardCrdt,
	writePortableBoardCrdt,
} from "../../src/state/portable-board-store";
import { getWorkspaceDirectoryPath, loadWorkspaceState, saveWorkspaceState } from "../../src/state/workspace-state";
import { createGitTestEnv } from "../utilities/git-env";

// ── helpers ─────────────────────────────────────────────────────────────────

function uniqueDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function initGitRepo(dir: string): void {
	const result = spawnSync("git", ["init"], {
		cwd: dir,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(`git init failed in ${dir}`);
	}
}

/** A full 6-column board with one card in backlog — the minimal save payload. */
function makeBoard(cardId: string, cardTitle: string, cardPrompt: string) {
	const now = 1_700_000_000_000;
	return {
		columns: [
			{
				id: "backlog" as const,
				title: "Backlog",
				cards: [
					{
						id: cardId,
						title: cardTitle,
						prompt: cardPrompt,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "planning" as const, title: "Planning", cards: [] },
			{ id: "in_progress" as const, title: "In Progress", cards: [] },
			{ id: "review" as const, title: "Review", cards: [] },
			{ id: "completed" as const, title: "Completed", cards: [] },
			{ id: "trash" as const, title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function makeEmptyBoard() {
	return {
		columns: [
			{ id: "backlog" as const, title: "Backlog", cards: [] },
			{ id: "planning" as const, title: "Planning", cards: [] },
			{ id: "in_progress" as const, title: "In Progress", cards: [] },
			{ id: "review" as const, title: "Review", cards: [] },
			{ id: "completed" as const, title: "Completed", cards: [] },
			{ id: "trash" as const, title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

// ── env-swap fixture ─────────────────────────────────────────────────────────

let tempHome: string;
let repoDir: string;
let prevHome: string | undefined;
let prevUserProfile: string | undefined;

beforeEach(() => {
	selfObservationMocks.recordSelfObservation.mockReset();

	tempHome = uniqueDir("kanban-disk-format-home-");
	repoDir = uniqueDir("kanban-disk-format-repo-");
	mkdirSync(repoDir, { recursive: true });
	initGitRepo(repoDir);

	prevHome = process.env.HOME;
	prevUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
});

afterEach(() => {
	if (prevHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = prevHome;
	}
	if (prevUserProfile === undefined) {
		delete process.env.USERPROFILE;
	} else {
		process.env.USERPROFILE = prevUserProfile;
	}
	rmSync(tempHome, { recursive: true, force: true });
	rmSync(repoDir, { recursive: true, force: true });
});

// ── Test 1: board.json round-trip + raw shape ────────────────────────────────

describe("board.json on-disk format", () => {
	it("round-trip: saveWorkspaceState writes board.json with the 7 fixed columns in order, card fields, and a dependencies array", async () => {
		const board = makeBoard("card-abc", "My Task", "Do the thing");
		await saveWorkspaceState(repoDir, { board });

		// Locate the local mirror written into the repo itself:
		// <repo>/.nklein/nklein/workspace/board.json
		const localBoardPath = join(repoDir, ".nklein", "nklein", "workspace", "board.json");
		const rawJson = JSON.parse(readFileSync(localBoardPath, "utf8")) as Record<string, unknown>;

		// --- raw shape assertions (format-pinning) ---
		expect(Array.isArray(rawJson.columns)).toBe(true);
		expect(Array.isArray(rawJson.dependencies)).toBe(true);

		const columns = rawJson.columns as Array<{ id: string; title: string; cards: unknown[] }>;
		const columnIds = columns.map((c) => c.id);

		// The 7 fixed column IDs must be present and in canonical order (Ready lane added by todo 11116).
		expect(columnIds).toEqual(["backlog", "planning", "ready", "in_progress", "review", "completed", "trash"]);

		// The backlog column must contain our card with the expected fields.
		const backlogCol = columns.find((c) => c.id === "backlog");
		expect(backlogCol).toBeDefined();
		const cards = backlogCol?.cards as Array<Record<string, unknown>> | undefined;
		expect(cards).toHaveLength(1);
		const card = cards?.[0] as Record<string, unknown> | undefined;
		expect(card?.id).toBe("card-abc");
		expect(card?.title).toBe("My Task");
		expect(card?.prompt).toBe("Do the thing");
		expect(card?.startInPlanMode).toBe(false);
		expect(card?.baseRef).toBe("main");
		expect(typeof card?.createdAt).toBe("number");
		expect(typeof card?.updatedAt).toBe("number");

		// dependencies must be a top-level array (empty here).
		expect(rawJson.dependencies).toEqual([]);

		// --- TS round-trip: loadWorkspaceState should parse the written file back correctly ---
		const loaded = await loadWorkspaceState(repoDir);
		const backlogLoaded = loaded.board.columns.find((c) => c.id === "backlog");
		expect(backlogLoaded?.cards).toHaveLength(1);
		expect(backlogLoaded?.cards[0]?.id).toBe("card-abc");
		expect(backlogLoaded?.cards[0]?.prompt).toBe("Do the thing");
		expect(loaded.board.dependencies).toEqual([]);
	});

	it("known-good fixture: a hand-crafted minimal board.json (Python-writer direction) is accepted by loadWorkspaceState", async () => {
		// Register the workspace in the global index and populate identity.json by saving an empty board first.
		// This gives us the workspaceId we need to locate the runtime-home board.json path.
		const saved = await saveWorkspaceState(repoDir, { board: makeEmptyBoard() });
		const workspaceId = saved.statePath.split("/").at(-1) ?? "";

		const fixtureBoardJson = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "py-task-1",
							title: "Python-authored task",
							prompt: "Written by a Python backend",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1_700_000_000_000,
							updatedAt: 1_700_000_000_000,
						},
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		const fixtureJson = JSON.stringify(fixtureBoardJson, null, 2);

		// Overwrite both the runtime-home copy (read first) and the local mirror (read as fallback).
		// The runtime-home path is: <tempHome>/.nklein/nklein/workspaces/<workspaceId>/board.json
		writeFileSync(join(getWorkspaceDirectoryPath(workspaceId), "board.json"), fixtureJson);
		writeFileSync(join(repoDir, ".nklein", "nklein", "workspace", "board.json"), fixtureJson);

		// loadWorkspaceState must parse the hand-crafted file without throwing.
		const loaded = await loadWorkspaceState(repoDir);
		const backlog = loaded.board.columns.find((c) => c.id === "backlog");
		expect(backlog?.cards).toHaveLength(1);
		expect(backlog?.cards[0]?.id).toBe("py-task-1");
		expect(backlog?.cards[0]?.prompt).toBe("Written by a Python backend");
	});
});

// ── Test 2: portable board CRDT round-trip + migration registry ──────────────

describe("board-crdt.json on-disk format (portable CRDT)", () => {
	it("round-trip: export then readPortableBoardCrdt returns the expected CRDT shape", async () => {
		const board = makeBoard("crdt-card-1", "CRDT Task", "Do CRDT things");
		const crdt = boardToPortableBoardCrdt(board, "replica-1");
		await writePortableBoardCrdt(repoDir, crdt);

		// Assert the raw JSON shape on disk.
		const crdtPath = getPortableBoardCrdtPath(repoDir);
		const rawJson = JSON.parse(readFileSync(crdtPath, "utf8")) as Record<string, unknown>;

		expect(rawJson.schemaVersion).toBe(1);
		expect(typeof rawJson.cards).toBe("object");
		expect(typeof rawJson.dependencies).toBe("object");

		// The card entry must be a LWW register map keyed by field name.
		const cards = rawJson.cards as Record<string, unknown>;
		expect("crdt-card-1" in cards).toBe(true);
		const cardEntry = cards["crdt-card-1"] as Record<string, unknown>;
		expect(cardEntry.id).toBe("crdt-card-1");
		expect(typeof cardEntry.fields).toBe("object");
		expect(typeof cardEntry.deleted).toBe("object");

		// Read back through the TS module — must match what was written.
		const readBack = await readPortableBoardCrdt(repoDir);
		expect(readBack).not.toBeNull();
		expect(readBack?.schemaVersion).toBe(CURRENT_PORTABLE_BOARD_SCHEMA_VERSION);
		expect(Object.keys(readBack?.cards ?? {})).toContain("crdt-card-1");
	});

	it("migratePortableBoardCrdt: refuses a document written by a newer schema (forward-compat guard)", () => {
		const tooNew = { schemaVersion: CURRENT_PORTABLE_BOARD_SCHEMA_VERSION + 1, cards: {}, dependencies: {} };
		expect(migratePortableBoardCrdt(tooNew)).toBeNull();
	});

	it("migratePortableBoardCrdt: refuses an unversioned document with no registered migration", () => {
		// schemaVersion missing → treated as 0, no migration registered → must return null.
		expect(migratePortableBoardCrdt({ cards: {}, dependencies: {} })).toBeNull();
	});

	it("migratePortableBoardCrdt: forward-migrates an older version when a migration is registered", () => {
		// Simulate a legacy v0 document plus a synthetic 0→current migration to exercise the chain mechanism.
		const currentCards = boardToPortableBoardCrdt(makeBoard("migrated-card", "Migrated", "Was v0"), "r1").cards;

		const upgrade: PortableBoardCrdtMigration = (input) => ({
			...input,
			schemaVersion: CURRENT_PORTABLE_BOARD_SCHEMA_VERSION,
			cards: currentCards,
			dependencies: {},
		});

		const legacy = { schemaVersion: 0, cards: { old: {} } };
		const migrated = migratePortableBoardCrdt(legacy, { 0: upgrade });

		expect(migrated).not.toBeNull();
		expect(migrated?.schemaVersion).toBe(CURRENT_PORTABLE_BOARD_SCHEMA_VERSION);
		expect(Object.keys(migrated?.cards ?? {})).toContain("migrated-card");
	});

	it("migratePortableBoardCrdt: accepts a current-version document unchanged in shape", () => {
		const crdt = boardToPortableBoardCrdt(makeBoard("card-v1", "V1 card", "current schema"), "r1");
		const roundTripped = migratePortableBoardCrdt(JSON.parse(JSON.stringify(crdt)));
		expect(roundTripped?.schemaVersion).toBe(CURRENT_PORTABLE_BOARD_SCHEMA_VERSION);
		expect(Object.keys(roundTripped?.cards ?? {})).toContain("card-v1");
	});
});

// ── Test 3: task-graph.json shape (plan artifacts) ────────────────────────────

describe("tasks.json on-disk format (plan artifact task graph)", () => {
	it("readNKleinPlanArtifacts parses a hand-crafted tasks.json with the expected fields", async () => {
		const slug = "test-plan";
		const planDir = join(repoDir, ".nklein", "nklein", "plans", slug);
		mkdirSync(planDir, { recursive: true });

		// Minimal valid task-graph.json as a Python backend would write it.
		const taskGraphFixture = {
			schemaVersion: 1,
			slug,
			title: "Test Plan",
			tasks: [
				{
					id: "task-alpha",
					title: "Alpha Task",
					prompt: "Do alpha work",
					dependsOn: [],
					complexity: 40,
					suggestedRole: "worker",
					filesLikelyTouched: ["src/alpha.ts"],
					acceptanceCommand: null,
					testFirst: false,
					acceptanceTestPrompt: null,
				},
				{
					id: "task-beta",
					title: "Beta Task",
					prompt: "Do beta work",
					dependsOn: ["task-alpha"],
					complexity: 60,
					suggestedRole: null,
					filesLikelyTouched: [],
					acceptanceCommand: "npm test",
					testFirst: true,
					acceptanceTestPrompt: "Write a beta integration test first.",
				},
			],
		};

		// Write the required companion files; artifact.json is omitted to exercise the legacy-metadata fallback.
		writeFileSync(join(planDir, "tasks.json"), JSON.stringify(taskGraphFixture, null, 2));
		writeFileSync(join(planDir, "spec.md"), "# Spec\n\nMinimal spec.\n");
		writeFileSync(join(planDir, "plan.md"), "# Plan\n\nMinimal plan.\n");

		// Parse via the TS reader.
		const artifacts = await readNKleinPlanArtifacts(repoDir, slug);

		// Raw shape: schemaVersion, slug, title, tasks[].
		expect(artifacts.taskGraph.schemaVersion).toBe(1);
		expect(artifacts.taskGraph.slug).toBe(slug);
		expect(artifacts.taskGraph.title).toBe("Test Plan");
		expect(artifacts.taskGraph.tasks).toHaveLength(2);

		// First task: required fields.
		const alpha = artifacts.taskGraph.tasks.find((t) => t.id === "task-alpha");
		expect(alpha).toBeDefined();
		expect(alpha?.title).toBe("Alpha Task");
		expect(alpha?.prompt).toBe("Do alpha work");
		expect(alpha?.dependsOn).toEqual([]);
		expect(alpha?.complexity).toBe(40);
		expect(alpha?.suggestedRole).toBe("worker");
		expect(alpha?.filesLikelyTouched).toEqual(["src/alpha.ts"]);
		expect(alpha?.testFirst).toBe(false);

		// Second task: dependsOn pinned.
		const beta = artifacts.taskGraph.tasks.find((t) => t.id === "task-beta");
		expect(beta).toBeDefined();
		expect(beta?.dependsOn).toEqual(["task-alpha"]);
		expect(beta?.acceptanceCommand).toBe("npm test");
		expect(beta?.testFirst).toBe(true);
		expect(beta?.acceptanceTestPrompt).toContain("beta integration test");
	});

	it("nkleinPlanTaskGraphSchema validates a minimal tasks.json and fills in defaults", () => {
		// Matches what a Python backend would write for the minimum required fields.
		const minimalGraph = nkleinPlanTaskGraphSchema.parse({
			schemaVersion: 1,
			slug: "minimal-plan",
			title: "Minimal",
			tasks: [
				{
					id: "t1",
					title: "Task One",
					prompt: "Do it",
				},
			],
		});

		expect(minimalGraph.schemaVersion).toBe(1);
		expect(minimalGraph.slug).toBe("minimal-plan");
		const task0 = minimalGraph.tasks[0];
		expect(task0?.dependsOn).toEqual([]);
		expect(task0?.complexity).toBe(50);
		expect(task0?.suggestedRole).toBeNull();
		expect(task0?.filesLikelyTouched).toEqual([]);
		expect(task0?.acceptanceCommand).toBeNull();
		expect(task0?.testFirst).toBe(false);
		expect(task0?.acceptanceTestPrompt).toBeNull();
	});

	it("nkleinPlanTaskGraphSchema rejects a missing required field (id)", () => {
		expect(() =>
			nkleinPlanTaskGraphSchema.parse({
				schemaVersion: 1,
				slug: "bad-plan",
				title: "Bad",
				tasks: [
					{
						// id missing
						title: "Task",
						prompt: "Do it",
					},
				],
			}),
		).toThrow();
	});
});
