import { describe, expect, it } from "vitest";
import {
	getLinkFailureMessage,
	parseListColumn,
	resolveTaskCommandTarget,
} from "../../../src/commands/task/task-record-format";

describe("resolveTaskCommandTarget", () => {
	it("resolves a task-id or a column target", () => {
		expect(resolveTaskCommandTarget({ taskId: "  t1  " }, "move")).toEqual({ kind: "task", taskId: "t1" });
		expect(resolveTaskCommandTarget({ column: "review" }, "move")).toEqual({ kind: "column", column: "review" });
	});

	it("rejects supplying both or neither, naming the command", () => {
		expect(() => resolveTaskCommandTarget({ taskId: "t1", column: "review" }, "move")).toThrow(
			/move accepts exactly one/u,
		);
		expect(() => resolveTaskCommandTarget({}, "move")).toThrow(/move requires either/u);
	});
});

describe("parseListColumn", () => {
	it("passes through undefined and the canonical column ids", () => {
		expect(parseListColumn(undefined)).toBeUndefined();
		for (const column of ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const) {
			expect(parseListColumn(column)).toBe(column);
		}
	});

	it("aliases 'done' to 'completed'", () => {
		expect(parseListColumn("done")).toBe("completed");
	});

	it("throws on an unknown column", () => {
		expect(() => parseListColumn("nope")).toThrow(/Invalid column "nope"/u);
	});
});

describe("getLinkFailureMessage", () => {
	it("maps each link-failure reason to a distinct message", () => {
		expect(getLinkFailureMessage("same_task")).toMatch(/cannot be linked to itself/u);
		expect(getLinkFailureMessage("duplicate")).toMatch(/already linked/u);
		expect(getLinkFailureMessage("trash_task")).toMatch(/done tasks/u);
		expect(getLinkFailureMessage("non_backlog")).toMatch(/at least one backlog/u);
		expect(getLinkFailureMessage("missing_task")).toMatch(/could not be found/u);
	});
});
