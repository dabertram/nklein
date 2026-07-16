import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QueuedOutwardAction } from "../../../src/core/outward-action-queue";
import {
	enqueueOutwardAction,
	readOutwardActionQueue,
	setOutwardActionStatus,
} from "../../../src/state/outward-action-queue-store";

const action = (over: Partial<QueuedOutwardAction>): QueuedOutwardAction => ({
	id: "id1",
	toolName: "issues__post_comment",
	target: "issue-7",
	argsSummary: 'body="hi"',
	reason: "outward action needs approval",
	status: "pending",
	at: 1,
	...over,
});

describe("outward-action-queue-store", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "nklein-outq-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("enqueues and reads back actions; a missing log reads empty", async () => {
		expect(await readOutwardActionQueue({ rootDir: root })).toEqual([]);
		await enqueueOutwardAction(action({ id: "a" }), { rootDir: root });
		await enqueueOutwardAction(action({ id: "b", toolName: "pr__create" }), { rootDir: root });
		const read = await readOutwardActionQueue({ rootDir: root });
		expect(read.map((a) => a.id)).toEqual(["a", "b"]);
	});

	it("updates a queued action's status by id (operator review) and reports found/not-found", async () => {
		await enqueueOutwardAction(action({ id: "a" }), { rootDir: root });
		await enqueueOutwardAction(action({ id: "b" }), { rootDir: root });

		expect(await setOutwardActionStatus("a", "approved", { rootDir: root })).toBe(true);
		expect(await setOutwardActionStatus("missing", "approved", { rootDir: root })).toBe(false);

		const read = await readOutwardActionQueue({ rootDir: root });
		expect(read.find((a) => a.id === "a")?.status).toBe("approved");
		expect(read.find((a) => a.id === "b")?.status).toBe("pending"); // untouched
		expect(read).toHaveLength(2); // rewrite preserved every record
	});

	it("rejecting then reading reflects the terminal status", async () => {
		await enqueueOutwardAction(action({ id: "a" }), { rootDir: root });
		await setOutwardActionStatus("a", "rejected", { rootDir: root });
		expect((await readOutwardActionQueue({ rootDir: root }))[0]?.status).toBe("rejected");
	});
});
