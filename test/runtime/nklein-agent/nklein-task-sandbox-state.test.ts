import { describe, expect, it } from "vitest";

import { TaskSandboxStateStore } from "../../../src/nklein-agent/nklein-task-sandbox-state";
import type { TaskResultBranch } from "../../../src/workspace/task-result-branches";

describe("TaskSandboxStateStore", () => {
	it("stores and reads the repo-path/base-ref pair per task", () => {
		const store = new TaskSandboxStateStore();
		store.setSandbox("t1", "/repo/a", "HEAD");
		store.setSandbox("t2", "/repo/b", "abc123");

		expect(store.getRepoPath("t1")).toBe("/repo/a");
		expect(store.getBaseRef("t1")).toBe("HEAD");
		expect(store.getRepoPath("t2")).toBe("/repo/b");
		expect(store.getBaseRef("t2")).toBe("abc123");
		expect(store.getRepoPath("missing")).toBeUndefined();
		expect(store.getBaseRef("missing")).toBeUndefined();
	});

	it("hasSandbox is true only when both repo path and base ref are present", () => {
		const store = new TaskSandboxStateStore();
		expect(store.hasSandbox("t1")).toBe(false);
		store.setSandbox("t1", "/repo/a", "HEAD");
		expect(store.hasSandbox("t1")).toBe(true);
	});

	it("deleteSandbox forgets the pair but leaves the finalizing guard untouched", () => {
		const store = new TaskSandboxStateStore();
		store.setSandbox("t1", "/repo/a", "HEAD");
		store.markFinalizing("t1");

		store.deleteSandbox("t1");

		expect(store.hasSandbox("t1")).toBe(false);
		expect(store.getRepoPath("t1")).toBeUndefined();
		// The finalizing guard is a separate concern — deleteSandbox must NOT clear it.
		expect(store.isFinalizing("t1")).toBe(true);
	});

	it("tracks the finalizing-review guard independently with mark/unmark", () => {
		const store = new TaskSandboxStateStore();
		expect(store.isFinalizing("t1")).toBe(false);
		store.markFinalizing("t1");
		expect(store.isFinalizing("t1")).toBe(true);
		store.unmarkFinalizing("t1");
		expect(store.isFinalizing("t1")).toBe(false);
	});

	it("releases redrive waiters only after finalization is unmarked", async () => {
		const store = new TaskSandboxStateStore();
		store.markFinalizing("t1");
		let settled = false;
		const wait = store.waitForFinalization("t1").then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		store.unmarkFinalizing("t1");
		await wait;
		expect(settled).toBe(true);
	});

	it("records a result branch without disturbing the sandbox pair", () => {
		const store = new TaskSandboxStateStore();
		store.setSandbox("t1", "/repo/a", "HEAD");
		const branch: TaskResultBranch = {
			taskId: "t1",
			branchName: "nklein/result/t1",
			refName: "refs/heads/nklein/result/t1",
			headCommit: "head",
			baseCommit: "base",
		};
		store.setResultBranch("t1", branch);
		// The result branch is write-only today; setting it leaves the readable pair intact.
		expect(store.getRepoPath("t1")).toBe("/repo/a");
		expect(store.getBaseRef("t1")).toBe("HEAD");
	});

	it("clear() drops every collection", () => {
		const store = new TaskSandboxStateStore();
		store.setSandbox("t1", "/repo/a", "HEAD");
		store.markFinalizing("t1");
		store.setResultBranch("t1", {
			taskId: "t1",
			branchName: "b",
			refName: "refs/heads/b",
			headCommit: "h",
			baseCommit: "base",
		});

		store.clear();

		expect(store.hasSandbox("t1")).toBe(false);
		expect(store.isFinalizing("t1")).toBe(false);
		expect(store.getRepoPath("t1")).toBeUndefined();
	});

	it("delivery-settled survives deleteSandbox (stragglers must read it) but resets on a fresh sandbox", () => {
		const store = new TaskSandboxStateStore();
		store.setSandbox("t1", "/repo/a", "HEAD");
		store.markRecaptureExpected("t1", "bounce round 2");

		store.markDeliverySettled("t1");
		expect(store.isDeliverySettled("t1")).toBe(true);
		// Settling the delivery cancels any owed recapture — the merge consumed the result.
		expect(store.recaptureExpectedReason("t1")).toBeNull();

		// A post-delivery cleanup forgets the placement, but a capture closure taken BEFORE the forget still needs
		// to see the settled flag to classify its failure as benign supersede.
		store.deleteSandbox("t1");
		expect(store.isDeliverySettled("t1")).toBe(true);

		// A redrive prepares a NEW sandbox: that attempt owes its own capture.
		store.setSandbox("t1", "/repo/a", "HEAD");
		expect(store.isDeliverySettled("t1")).toBe(false);

		store.markDeliverySettled("t1");
		store.clear();
		expect(store.isDeliverySettled("t1")).toBe(false);
	});
});
