import { describe, expect, it, vi } from "vitest";

import type { getNKleinLargeFileWorkflow } from "../../../src/nklein-agent/nklein-large-file-workflow";
import { createTaskToolApprovalWrapper } from "../../../src/nklein-agent/nklein-task-tool-approval";
import type {
	NKleinSdkToolApprovalRequest,
	NKleinSdkToolApprovalResult,
} from "../../../src/nklein-agent/sdk-runtime-boundary";

// The per-session tool-approval wrapper extracted from nklein-session-runtime.startTaskSession. These tests exercise its
// decision LOGIC directly (turn-serialization of content reads, read-content dedup, and cache invalidation on a
// repo-mutating tool) — previously only covered transitively via the session-runtime suite. The large-file blocking
// path and the fingerprint helpers have their own unit tests, so the workflow here is a never-blocks stub.

function stubWorkflow(): ReturnType<typeof getNKleinLargeFileWorkflow> {
	return {
		getReadFilesBlockingReason: async () => null,
		getReadLargeFileBlockingReason: async () => null,
	} as unknown as ReturnType<typeof getNKleinLargeFileWorkflow>;
}

function req(over: Partial<NKleinSdkToolApprovalRequest> = {}): NKleinSdkToolApprovalRequest {
	return {
		sessionId: "s1",
		agentId: "a1",
		conversationId: "c1",
		iteration: 1,
		toolName: "read_files",
		toolCallId: "call-1",
		input: ["src/a.ts"],
		...over,
	} as unknown as NKleinSdkToolApprovalRequest;
}

function makeWrapper(
	base: ((request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>) | undefined,
) {
	return createTaskToolApprovalWrapper({
		baseRequestToolApproval: base,
		largeFileWorkflow: stubWorkflow(),
		taskId: "t1",
		hostWorkspaceRoot: "/ws",
		// left undefined so the §5.B auto-promote board mutation (which needs a real workspace) is skipped; the
		// cache-invalidation branch it lives under is still exercised.
		onCardPromoted: undefined,
	});
}

describe("createTaskToolApprovalWrapper", () => {
	it("returns undefined when there is no base approval callback", () => {
		expect(makeWrapper(undefined)).toBeUndefined();
	});

	it("approves a first read and passes it through to the base callback", async () => {
		const base = vi.fn(async () => ({ approved: true }) satisfies NKleinSdkToolApprovalResult);
		const wrapper = makeWrapper(base);
		expect(wrapper).toBeDefined();

		const result = await wrapper?.(req());

		expect(result?.approved).toBe(true);
		expect(base).toHaveBeenCalledTimes(1);
	});

	it("blocks a second content-read started within the same assistant turn", async () => {
		const base = vi.fn(async () => ({ approved: true }) satisfies NKleinSdkToolApprovalResult);
		const wrapper = makeWrapper(base);

		await wrapper?.(req({ toolCallId: "call-1" }));
		const second = await wrapper?.(req({ toolCallId: "call-2" }));

		expect(second?.approved).toBe(false);
		expect(second?.reason).toContain("already started read_files");
		// The base callback saw only the first read; the second was rejected before reaching it.
		expect(base).toHaveBeenCalledTimes(1);
	});

	it("allows a harmless discovery tool in the same turn as a read", async () => {
		const base = vi.fn(async () => ({ approved: true }) satisfies NKleinSdkToolApprovalResult);
		const wrapper = makeWrapper(base);

		await wrapper?.(req({ toolCallId: "call-1" }));
		const listing = await wrapper?.(req({ toolName: "list_files", toolCallId: "call-2" }));

		expect(listing?.approved).toBe(true);
	});

	it("blocks re-reading a file whose content was already read in the task", async () => {
		const base = vi.fn(async () => ({ approved: true }) satisfies NKleinSdkToolApprovalResult);
		const wrapper = makeWrapper(base);

		await wrapper?.(req({ iteration: 1, toolCallId: "call-1", input: ["src/a.ts"] }));
		const reread = await wrapper?.(req({ iteration: 2, toolCallId: "call-2", input: ["src/a.ts"] }));

		expect(reread?.approved).toBe(false);
		expect(reread?.reason).toContain("already read");
	});

	it("re-allows a re-read after a repo-mutating tool invalidates the read caches", async () => {
		const base = vi.fn(async () => ({ approved: true }) satisfies NKleinSdkToolApprovalResult);
		const wrapper = makeWrapper(base);

		await wrapper?.(req({ iteration: 1, toolCallId: "call-1", input: ["src/a.ts"] }));
		// A repo-map-invalidating tool (edit_file) clears the read-dedup caches.
		await wrapper?.(req({ toolName: "edit_file", iteration: 2, toolCallId: "call-2", input: { path: "src/a.ts" } }));
		const reread = await wrapper?.(req({ iteration: 3, toolCallId: "call-3", input: ["src/a.ts"] }));

		expect(reread?.approved).toBe(true);
	});
});

describe("compaction releases the anti-re-read guard (2026-09-02 spec-churn fix)", () => {
	it("allows ONE re-read of a target after its result was elided from context", async () => {
		const { createTaskToolApprovalWrapper, releaseCompactedReadFilesTargets } = await import(
			"../../../src/nklein-agent/nklein-task-tool-approval"
		);
		const approveMaybe = createTaskToolApprovalWrapper({
			baseRequestToolApproval: async () => ({ approved: true }),
			largeFileWorkflow: {
				getReadFilesBlockingReason: async () => null,
				getReadLargeFileBlockingReason: async () => null,
			},
			taskId: "task-guard-release",
			hostWorkspaceRoot: "/tmp/x",
		} as never);
		if (!approveMaybe) {
			throw new Error("wrapper expected when a base approval exists");
		}
		const approve = approveMaybe;
		const input = { files: [{ path: "spec.md", start_line: 100, end_line: 140 }] };
		const request = (id: string) =>
			({
				toolName: "read_files",
				toolCallId: id,
				input,
				sessionId: "s",
				agentId: "a",
				conversationId: "c",
				iteration: id,
			}) as never;
		expect((await approve(request("r1"))).approved).toBe(true);
		// Same range again: blocked (content is in context).
		expect((await approve(request("r2"))).approved).toBe(false);
		// Context focus elides the result → release → one re-read allowed.
		releaseCompactedReadFilesTargets("task-guard-release", input);
		expect((await approve(request("r3"))).approved).toBe(true);
		// And the guard re-arms after that read.
		expect((await approve(request("r4"))).approved).toBe(false);
	});
});
