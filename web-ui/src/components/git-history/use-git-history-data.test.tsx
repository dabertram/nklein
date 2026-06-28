import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGitHistoryData } from "@/components/git-history/use-git-history-data";
import type {
	RuntimeGitCommitDiffResponse,
	RuntimeGitLogResponse,
	RuntimeGitRefsResponse,
	RuntimeGitSyncSummary,
	RuntimeWorkspaceChangesResponse,
} from "@/runtime/types";

const getGitRefsQueryMock = vi.hoisted(() => vi.fn());
const getGitLogQueryMock = vi.hoisted(() => vi.fn());
const getCommitDiffQueryMock = vi.hoisted(() => vi.fn());
const getChangesQueryMock = vi.hoisted(() => vi.fn());
const getWorkspaceChangesQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			getGitRefs: {
				query: getGitRefsQueryMock,
			},
			getGitLog: {
				query: getGitLogQueryMock,
			},
			getCommitDiff: {
				query: getCommitDiffQueryMock,
			},
			getChanges: {
				query: getChangesQueryMock,
			},
			getWorkspaceChanges: {
				query: getWorkspaceChangesQueryMock,
			},
		},
	}),
}));

interface HookSnapshot {
	refs: string[];
	activeRefName: string | null;
	commits: string[];
	totalCommitCount: number;
	selectedCommitHash: string | null;
	isRefsLoading: boolean;
	isLogLoading: boolean;
	isDiffLoading: boolean;
}

function createGitSummary(branch: string): RuntimeGitSyncSummary {
	return {
		currentBranch: branch,
		upstreamBranch: `origin/${branch}`,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		aheadCount: 0,
		behindCount: 0,
	};
}

function createRefsResponse(
	branch: string,
	hash: string,
	options?: { includeRemote?: boolean; remoteHash?: string },
): RuntimeGitRefsResponse {
	return {
		ok: true,
		refs: [
			{
				name: branch,
				type: "branch",
				hash,
				isHead: true,
				upstreamName: options?.includeRemote ? `origin/${branch}` : undefined,
				ahead: 0,
				behind: 0,
			},
			...(options?.includeRemote
				? [
						{
							name: `origin/${branch}`,
							type: "remote" as const,
							hash: options.remoteHash ?? hash,
							isHead: false,
						},
					]
				: []),
		],
	};
}

function createLogResponse(
	hashOrCommits: string | Array<{ hash: string; message: string; relation?: "selected" | "upstream" | "shared" }>,
	message?: string,
): RuntimeGitLogResponse {
	const commits =
		typeof hashOrCommits === "string"
			? [
					{
						hash: hashOrCommits,
						message: message ?? "Test commit",
					},
				]
			: hashOrCommits;

	return {
		ok: true,
		totalCount: commits.length,
		commits: commits.map((commit) => ({
			hash: commit.hash,
			shortHash: commit.hash.slice(0, 8),
			authorName: "Test User",
			authorEmail: "test@example.com",
			date: "2026-03-12T00:00:00.000Z",
			message: commit.message,
			parentHashes: [],
			relation: commit.relation,
		})),
	};
}

function createDiffResponse(hash: string): RuntimeGitCommitDiffResponse {
	return {
		ok: true,
		commitHash: hash,
		files: [],
	};
}

function createWorkspaceChangesResponse(): RuntimeWorkspaceChangesResponse {
	return {
		repoRoot: "/tmp/project",
		generatedAt: Date.now(),
		files: [],
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function HookHarness({
	taskScope,
	enabled = true,
	stateVersion = 0,
	onRender,
}: {
	taskScope: { taskId: string; baseRef: string } | null;
	enabled?: boolean;
	stateVersion?: number;
	onRender: (snapshot: HookSnapshot) => void;
}): null {
	const gitHistory = useGitHistoryData({
		workspaceId: "project-1",
		taskScope,
		gitSummary: createGitSummary(taskScope ? "task-branch" : "main"),
		stateVersion,
		enabled,
	});

	onRender({
		refs: gitHistory.refs.map((ref) => ref.name),
		activeRefName: gitHistory.activeRef?.name ?? null,
		commits: gitHistory.commits.map((commit) => commit.hash),
		totalCommitCount: gitHistory.totalCommitCount,
		selectedCommitHash: gitHistory.selectedCommitHash,
		isRefsLoading: gitHistory.isRefsLoading,
		isLogLoading: gitHistory.isLogLoading,
		isDiffLoading: gitHistory.isDiffLoading,
	});

	return null;
}

describe("useGitHistoryData", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		getGitRefsQueryMock.mockReset();
		getGitLogQueryMock.mockReset();
		getCommitDiffQueryMock.mockReset();
		getChangesQueryMock.mockReset();
		getWorkspaceChangesQueryMock.mockReset();

		getGitRefsQueryMock.mockImplementation(async (taskScope: { taskId: string; baseRef: string } | null) =>
			taskScope ? createRefsResponse("task-branch", "taskhash1") : createRefsResponse("main", "homehash1"),
		);
		getGitLogQueryMock.mockImplementation(
			async ({ taskScope }: { taskScope?: { taskId: string; baseRef: string } | null }) =>
				taskScope ? createLogResponse("taskhash1", "Task commit") : createLogResponse("homehash1", "Home commit"),
		);
		getCommitDiffQueryMock.mockImplementation(async ({ commitHash }: { commitHash: string }) =>
			createDiffResponse(commitHash),
		);
		getChangesQueryMock.mockImplementation(async () => createWorkspaceChangesResponse());
		getWorkspaceChangesQueryMock.mockImplementation(async () => createWorkspaceChangesResponse());

		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("does not expose home git history data during a task scope transition", async () => {
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		const settledHomeSnapshot = snapshots.at(-1);
		expect(settledHomeSnapshot).toMatchObject({
			refs: ["main"],
			activeRefName: "main",
			commits: ["homehash1"],
		});

		const firstTaskScopeSnapshotIndex = snapshots.length;
		await act(async () => {
			root.render(
				<HookHarness
					taskScope={{
						taskId: "task-1",
						baseRef: "main",
					}}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		const transitionSnapshot = snapshots[firstTaskScopeSnapshotIndex];
		expect(transitionSnapshot).toMatchObject({
			refs: [],
			activeRefName: null,
			commits: [],
			selectedCommitHash: null,
			isRefsLoading: true,
			isLogLoading: true,
			isDiffLoading: true,
		});
	});

	it("reports loading on the first render before git history queries resolve", async () => {
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		const firstSnapshot = snapshots[0];
		expect(firstSnapshot).toMatchObject({
			refs: [],
			activeRefName: null,
			commits: [],
			selectedCommitHash: null,
			isRefsLoading: true,
			isLogLoading: true,
			isDiffLoading: true,
		});
	});

	it("clears cached refs and diff data when the panel closes so reopen starts cleanly", async () => {
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		expect(snapshots.at(-1)).toMatchObject({
			refs: ["main"],
			activeRefName: "main",
			commits: ["homehash1"],
			selectedCommitHash: "homehash1",
			isRefsLoading: false,
			isLogLoading: false,
			isDiffLoading: false,
		});

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					enabled={false}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		const snapshotsBeforeReopen = snapshots.length;
		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					enabled={true}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		const reopenSnapshot = snapshots[snapshotsBeforeReopen];
		expect(reopenSnapshot).toMatchObject({
			refs: [],
			activeRefName: null,
			commits: [],
			selectedCommitHash: null,
			isRefsLoading: true,
			isLogLoading: true,
			isDiffLoading: true,
		});
	});

	it("loads the active branch together with its upstream remote when both refs are available", async () => {
		getGitRefsQueryMock.mockResolvedValue(createRefsResponse("main", "homehash1", { includeRemote: true }));

		await act(async () => {
			root.render(<HookHarness taskScope={null} onRender={() => {}} />);
			await flushPromises();
		});

		expect(getGitLogQueryMock).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: "main",
				refs: ["main", "origin/main"],
			}),
			expect.anything(),
		);
	});

	it("selects the checked out branch head by default when the remote has newer commits", async () => {
		const snapshots: HookSnapshot[] = [];

		getGitRefsQueryMock.mockResolvedValue(
			createRefsResponse("main", "homehash1", {
				includeRemote: true,
				remoteHash: "remotehash1",
			}),
		);
		getGitLogQueryMock.mockResolvedValue(
			createLogResponse([
				{ hash: "remotehash1", message: "Remote commit", relation: "upstream" },
				{ hash: "homehash1", message: "Local head", relation: "selected" },
				{ hash: "basehash1", message: "Base commit", relation: "shared" },
			]),
		);

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		expect(snapshots.at(-1)).toMatchObject({
			activeRefName: "main",
			commits: ["remotehash1", "homehash1", "basehash1"],
			selectedCommitHash: "homehash1",
		});
	});

	it("requests a fresh count on the foreground load but skips it on background refreshes, retaining the count (git-view P3)", async () => {
		const snapshots: HookSnapshot[] = [];

		// Foreground load returns a real total count of 2.
		getGitLogQueryMock.mockImplementation(async () =>
			createLogResponse([
				{ hash: "homehash1", message: "c1" },
				{ hash: "homehash0", message: "c0" },
			]),
		);

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					stateVersion={0}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		expect(snapshots.at(-1)?.totalCommitCount).toBe(2);
		// The foreground load asks the backend to compute the count.
		expect(getGitLogQueryMock.mock.calls[0]?.[0]?.includeTotalCount).toBe(true);

		// The backend returns the -1 "count unchanged" sentinel only when the count was skipped (silent refresh);
		// a foreground reload (includeTotalCount true) still gets a real count — mirror that here.
		getGitLogQueryMock.mockImplementation(async (arg: { includeTotalCount?: boolean }) => {
			const base = createLogResponse([
				{ hash: "homehash2", message: "c2" },
				{ hash: "homehash1", message: "c1" },
				{ hash: "homehash0", message: "c0" },
			]);
			return arg?.includeTotalCount === false ? { ...base, totalCount: -1 } : base;
		});

		vi.useFakeTimers();
		try {
			await act(async () => {
				root.render(
					<HookHarness
						taskScope={null}
						stateVersion={1}
						onRender={(snapshot) => {
							snapshots.push(snapshot);
						}}
					/>,
				);
				await flushPromises();
			});
			await act(async () => {
				vi.advanceTimersByTime(600);
				await flushPromises();
			});
		} finally {
			vi.useRealTimers();
		}

		const backgroundCall = getGitLogQueryMock.mock.calls.find(([arg]) => arg?.includeTotalCount === false);
		expect(backgroundCall).toBeDefined();
		// The -1 sentinel is ignored: the last known count (2) is retained even though the refresh loaded 3 commits.
		expect(snapshots.at(-1)?.commits).toEqual(["homehash2", "homehash1", "homehash0"]);
		expect(snapshots.at(-1)?.totalCommitCount).toBe(2);
	});

	it("coalesces a burst of workspace-state bumps into a single background log refresh (git-view P3)", async () => {
		await act(async () => {
			root.render(<HookHarness taskScope={null} stateVersion={0} onRender={() => {}} />);
			await flushPromises();
		});

		const backgroundCallsAfterMount = getGitLogQueryMock.mock.calls.filter(
			([arg]) => arg?.includeTotalCount === false,
		).length;
		expect(backgroundCallsAfterMount).toBe(0);

		vi.useFakeTimers();
		try {
			// Three rapid state bumps, each well within the debounce window.
			for (const version of [1, 2, 3]) {
				await act(async () => {
					root.render(<HookHarness taskScope={null} stateVersion={version} onRender={() => {}} />);
					await flushPromises();
				});
				await act(async () => {
					vi.advanceTimersByTime(100);
				});
			}

			// Still inside the trailing window — nothing has fired yet.
			expect(getGitLogQueryMock.mock.calls.filter(([arg]) => arg?.includeTotalCount === false)).toHaveLength(0);

			await act(async () => {
				vi.advanceTimersByTime(600);
				await flushPromises();
			});
		} finally {
			vi.useRealTimers();
		}

		// The burst collapsed into exactly one background refresh.
		expect(getGitLogQueryMock.mock.calls.filter(([arg]) => arg?.includeTotalCount === false)).toHaveLength(1);
	});
});
