import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import {
	boardCardToWorkPackage,
	classifyCardPairConflict,
	findActiveTaskLikelyTouchedFileOverlap,
	getSharedLikelyTouchedPaths,
	getSharedSpecificLikelyTouchedPaths,
	isCoarseLikelyTouchedPath,
	tasksHaveLikelyTouchedFileOverlap,
} from "../../src/core/task-file-overlap";

function createTask(
	id: string,
	filesLikelyTouched?: string[],
	bounds: { writeScope?: string[]; forbiddenPaths?: string[] } = {},
): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: id,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		filesLikelyTouched,
		...bounds,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createSession(taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "nklein",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

describe("task file overlap", () => {
	it("matches likely touched files with normalized relative paths", () => {
		expect(
			tasksHaveLikelyTouchedFileOverlap(createTask("a", ["./src/shared.ts"]), createTask("b", ["src/shared.ts"])),
		).toBe(true);
		expect(tasksHaveLikelyTouchedFileOverlap(createTask("a", ["src/a.ts"]), createTask("b", ["src/b.ts"]))).toBe(
			false,
		);
	});

	it("returns the shared culprit paths (normalized, sorted, deduped) for diagnostics", () => {
		expect(
			getSharedLikelyTouchedPaths(
				createTask("a", ["./src/Shared.ts", "src/z.ts", "package.json"]),
				createTask("b", ["src/shared.ts", "package.json", "src/other.ts"]),
			),
		).toEqual(["package.json", "src/shared.ts"]);
		expect(getSharedLikelyTouchedPaths(createTask("a", ["src/a.ts"]), createTask("b", ["src/b.ts"]))).toEqual([]);
		expect(getSharedLikelyTouchedPaths(createTask("a"), createTask("b", ["src/a.ts"]))).toEqual([]);
	});

	it("finds active overlapping tasks from board sessions", () => {
		const board: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [createTask("candidate", ["src/shared.ts"])] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [createTask("active", ["src/shared.ts"])] },
				{ id: "review", title: "Review", cards: [createTask("idle-review", ["src/shared.ts"])] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};

		expect(
			findActiveTaskLikelyTouchedFileOverlap({
				board,
				sessions: {
					active: createSession("active", "running"),
					"idle-review": createSession("idle-review", "idle"),
				},
				task: createTask("candidate", ["src/shared.ts"]),
			})?.id,
		).toBe("active");
	});
});

describe("coarse vs specific likely-touched paths (§5.AF/C5 over-serialization fix)", () => {
	it("classifies low-signal manifest/lockfile/config paths as coarse, specific source as not", () => {
		expect(isCoarseLikelyTouchedPath("package.json")).toBe(true);
		expect(isCoarseLikelyTouchedPath("pnpm-lock.yaml")).toBe(true);
		expect(isCoarseLikelyTouchedPath("tsconfig.build.json")).toBe(true); // tsconfig.*.json pattern
		expect(isCoarseLikelyTouchedPath("web-ui/package.json")).toBe(true); // basename match, any dir
		expect(isCoarseLikelyTouchedPath("src/shared.ts")).toBe(false);
		expect(isCoarseLikelyTouchedPath("src/config.ts")).toBe(false); // a real source file, not a config manifest
	});

	it("does NOT serialize two cards that share ONLY a coarse file (e.g. a defensively-listed package.json)", () => {
		expect(
			tasksHaveLikelyTouchedFileOverlap(
				createTask("a", ["package.json", "src/a.ts"]),
				createTask("b", ["package.json", "src/b.ts"]),
			),
		).toBe(false);
	});

	it("DOES serialize when a shared SPECIFIC source path exists (even alongside a shared coarse file)", () => {
		expect(
			tasksHaveLikelyTouchedFileOverlap(
				createTask("a", ["package.json", "src/shared.ts"]),
				createTask("b", ["package.json", "src/shared.ts"]),
			),
		).toBe(true);
	});

	it("getSharedSpecificLikelyTouchedPaths drops coarse paths but keeps specific (diagnostics keep all)", () => {
		const a = createTask("a", ["package.json", "src/shared.ts", "tsconfig.json"]);
		const b = createTask("b", ["package.json", "src/shared.ts", "tsconfig.json"]);
		expect(getSharedSpecificLikelyTouchedPaths(a, b)).toEqual(["src/shared.ts"]);
		// getSharedLikelyTouchedPaths still returns ALL shared (incl. coarse) for logging the culprit.
		expect(getSharedLikelyTouchedPaths(a, b)).toEqual(["package.json", "src/shared.ts", "tsconfig.json"]);
	});
});

describe("F1.9 work-package boundary enforcement at dispatch (§5.AK classifier)", () => {
	it("projects a card to a WorkPackage: explicit writeScope wins, glob tails stripped, forbidden carried", () => {
		expect(
			boardCardToWorkPackage(
				createTask("a", ["src/legacy.ts"], { writeScope: ["src/orders/**"], forbiddenPaths: ["src/auth/**"] }),
			),
		).toEqual({ id: "a", writeScope: ["src/orders"], forbiddenScope: ["src/auth"] });
		expect(boardCardToWorkPackage(createTask("b", ["src/b.ts"]))).toEqual({ id: "b", writeScope: ["src/b.ts"] });
	});

	it("serializes a card that writes inside an active card's forbiddenPaths (both directions, glob-aware)", () => {
		const guard = createTask("guard", undefined, {
			writeScope: ["src/auth/session.ts"],
			forbiddenPaths: ["src/payments/**"],
		});
		const intruder = createTask("intruder", ["src/payments/checkout.ts"]);
		expect(tasksHaveLikelyTouchedFileOverlap(guard, intruder)).toBe(true);
		expect(tasksHaveLikelyTouchedFileOverlap(intruder, guard)).toBe(true);
		expect(classifyCardPairConflict(guard, intruder).conflictClass).toBe("red");
		// Disjoint scopes with no forbidden violation stay green (parallel-safe).
		expect(classifyCardPairConflict(createTask("x", ["src/x.ts"]), createTask("y", ["src/y.ts"])).conflictClass).toBe(
			"green",
		);
	});

	it("proves Green/Yellow/Red ownership on a representative DAG: green fans out, yellow fans out, red serializes", () => {
		// A representative decomposed DAG: four workers off one root.
		//  - api + ui: disjoint specific scopes, shared coarse package.json ⇒ YELLOW ⇒ parallel-safe at dispatch.
		//  - api + migrations: both write src/db/schema.ts ⇒ RED ⇒ serialize.
		//  - docs writes inside api's forbidden src/api/** ⇒ RED ⇒ serialize.
		const api = createTask("api", ["src/api/routes.ts", "package.json", "src/db/schema.ts"], {
			forbiddenPaths: ["src/api/internal"],
		});
		const ui = createTask("ui", ["src/ui/app.tsx", "package.json"]);
		const migrations = createTask("migrations", ["src/db/schema.ts"]);
		const docs = createTask("docs", ["docs/api.md", "src/api/internal/notes.md"]);

		expect(classifyCardPairConflict(api, ui).conflictClass).toBe("yellow");
		expect(tasksHaveLikelyTouchedFileOverlap(api, ui)).toBe(false); // yellow fans out
		expect(classifyCardPairConflict(api, migrations).conflictClass).toBe("red");
		expect(tasksHaveLikelyTouchedFileOverlap(api, migrations)).toBe(true); // red serializes
		expect(classifyCardPairConflict(api, docs).forbiddenViolations[0]).toContain("forbidden");
		expect(tasksHaveLikelyTouchedFileOverlap(api, docs)).toBe(true); // forbidden write serializes
		expect(classifyCardPairConflict(ui, migrations).conflictClass).toBe("green");
		expect(tasksHaveLikelyTouchedFileOverlap(ui, migrations)).toBe(false); // green fans out

		// The live dispatch entry point sees the RED pair through the same classifier.
		const board: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [migrations] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [api] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		expect(
			findActiveTaskLikelyTouchedFileOverlap({
				board,
				sessions: { api: createSession("api", "running") },
				task: migrations,
			})?.id,
		).toBe("api");
		expect(
			findActiveTaskLikelyTouchedFileOverlap({
				board,
				sessions: { api: createSession("api", "running") },
				task: ui,
			}),
		).toBeNull();
	});
});
