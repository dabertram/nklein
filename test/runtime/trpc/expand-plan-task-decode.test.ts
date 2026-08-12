import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { resolvePlanTaskIdFromBoardTaskId } from "../../../src/trpc/runtime-api/expand-plan-task";

/**
 * The expand-plan-task board-id → plan-task-id decode (audit 2026-08-12). Board ids are
 * `<slugify(planSlug)>-<slugify(planTaskId)>` plus an optional NUMERIC dedupe suffix. The old first-match loop let
 * plan task "storage" claim board ids belonging to "storage-migration"; the decode is now exact-first with a
 * digits-only suffix pass, and an ambiguous match throws instead of guessing.
 */
describe("resolvePlanTaskIdFromBoardTaskId", () => {
	const tasks = [{ id: "storage" }, { id: "storage-migration" }];

	it("an exact base-id match beats a shorter task's prefix match", () => {
		// Old behavior: "storage" matched first via startsWith("demo-storage-") and won — the wrong task.
		expect(resolvePlanTaskIdFromBoardTaskId(tasks, "demo", "demo-storage-migration")).toBe("storage-migration");
	});

	it("accepts a numeric dedupe suffix on the exact base id", () => {
		expect(resolvePlanTaskIdFromBoardTaskId(tasks, "demo", "demo-storage-2")).toBe("storage");
		expect(resolvePlanTaskIdFromBoardTaskId(tasks, "demo", "demo-storage-migration-3")).toBe("storage-migration");
	});

	it("rejects a non-digit remainder — it belongs to some other task, not a dedupe of this one", () => {
		expect(resolvePlanTaskIdFromBoardTaskId(tasks, "demo", "demo-storage-extra")).toBeNull();
	});

	it("returns null when nothing matches at all", () => {
		expect(resolvePlanTaskIdFromBoardTaskId(tasks, "demo", "other-plan-storage")).toBeNull();
		expect(resolvePlanTaskIdFromBoardTaskId([], "demo", "demo-storage")).toBeNull();
	});

	it("slugifies both slug and task id (case/spacing collapse to '-')", () => {
		expect(resolvePlanTaskIdFromBoardTaskId([{ id: "Add Storage" }], "My Demo!", "my-demo-add-storage")).toBe(
			"Add Storage",
		);
	});

	it("throws the pass-planTaskId-explicitly error when slugification makes the match ambiguous", () => {
		// Slugification is lossy: distinct plan task ids can collide on the same board base id.
		const colliding = [{ id: "storage migration" }, { id: "storage-migration" }];
		expect(() => resolvePlanTaskIdFromBoardTaskId(colliding, "demo", "demo-storage-migration")).toThrowError(
			TRPCError,
		);
		expect(() => resolvePlanTaskIdFromBoardTaskId(colliding, "demo", "demo-storage-migration")).toThrowError(
			/Pass planTaskId explicitly/,
		);
	});

	it("ambiguity in the dedupe-suffix pass also throws rather than guessing", () => {
		const colliding = [{ id: "storage migration" }, { id: "storage-migration" }];
		expect(() => resolvePlanTaskIdFromBoardTaskId(colliding, "demo", "demo-storage-migration-2")).toThrowError(
			/Pass planTaskId explicitly/,
		);
	});
});
