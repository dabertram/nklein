import { describe, expect, it } from "vitest";
import {
	columnCanHaveLiveTaskSession,
	LIST_TASK_COLUMNS,
	type ListTaskColumn,
} from "../../../src/commands/task/task-command-types";

describe("columnCanHaveLiveTaskSession", () => {
	it("is true only for the active-work columns (a live session must be stopped before finish/delete)", () => {
		for (const col of ["planning", "in_progress", "review"] as ListTaskColumn[]) {
			expect(columnCanHaveLiveTaskSession(col)).toBe(true);
		}
		for (const col of ["backlog", "ready", "completed", "trash"] as ListTaskColumn[]) {
			expect(columnCanHaveLiveTaskSession(col)).toBe(false);
		}
	});

	it("covers every listed column (no column is unclassified)", () => {
		for (const col of LIST_TASK_COLUMNS) {
			expect(typeof columnCanHaveLiveTaskSession(col)).toBe("boolean");
		}
		expect(LIST_TASK_COLUMNS).toContain("in_progress");
		expect(LIST_TASK_COLUMNS).toContain("trash");
	});
});
