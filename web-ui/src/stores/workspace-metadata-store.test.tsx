import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	resetWorkspaceMetadataStore,
	setTaskWorkspaceSnapshot,
	subscribeToAnyTaskMetadata,
	useTaskWorkspaceSnapshotValue,
} from "@/stores/workspace-metadata-store";
import type { ReviewTaskWorkspaceSnapshot } from "@/types";

function snapshot(taskId: string, headCommit: string, changedFiles: number): ReviewTaskWorkspaceSnapshot {
	return {
		taskId,
		path: `/tmp/${taskId}`,
		branch: taskId,
		isDetached: false,
		headCommit,
		changedFiles,
		additions: changedFiles,
		deletions: 0,
	};
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("workspace-metadata-store notifications", () => {
	afterEach(async () => {
		resetWorkspaceMetadataStore();
		await flushMicrotasks();
	});

	it("defers task-metadata notifications to a microtask instead of firing synchronously", async () => {
		const notified: string[] = [];
		const unsubscribe = subscribeToAnyTaskMetadata((taskId) => notified.push(taskId));

		setTaskWorkspaceSnapshot(snapshot("task-1", "aaa111", 1));

		// A synchronous mutation must not notify subscribers. If it did, the
		// notification could land while React is mid-render/commit and trigger the
		// "Cannot update a component while rendering a different component" warning.
		expect(notified).toEqual([]);

		await flushMicrotasks();
		expect(notified).toEqual(["task-1"]);

		unsubscribe();
	});

	it("coalesces multiple synchronous mutations of the same task into one notification", async () => {
		const notified: string[] = [];
		const unsubscribe = subscribeToAnyTaskMetadata((taskId) => notified.push(taskId));

		setTaskWorkspaceSnapshot(snapshot("task-1", "aaa111", 1));
		setTaskWorkspaceSnapshot(snapshot("task-1", "bbb222", 2));
		setTaskWorkspaceSnapshot(snapshot("task-2", "ccc333", 3));

		expect(notified).toEqual([]);

		await flushMicrotasks();
		expect(notified.slice().sort()).toEqual(["task-1", "task-2"]);

		unsubscribe();
	});
});

describe("workspace-metadata-store React integration", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		await flushMicrotasks();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("does not warn when the store is mutated while another component is rendering", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			function Subscriber(): null {
				// Mirrors BoardCard subscribing to per-task workspace metadata.
				useTaskWorkspaceSnapshotValue("task-1");
				return null;
			}

			let mutateDuringRender = false;
			function Mutator(): null {
				// Reproduces the shape of the bug: a store mutation observed while
				// React is still rendering (a passive effect flushed mid-commit during
				// the seeding burst does the same thing in App).
				if (mutateDuringRender) {
					setTaskWorkspaceSnapshot(snapshot("task-1", "abc123", 1));
				}
				return null;
			}

			function Tree({ tick }: { tick: number }): React.ReactElement {
				return (
					<>
						<Subscriber />
						<Mutator />
						<span>{tick}</span>
					</>
				);
			}

			// Mount first so Subscriber registers its useSyncExternalStore subscription.
			await act(async () => {
				root.render(<Tree tick={0} />);
			});

			// Re-render with a sibling that mutates the store during its own render.
			mutateDuringRender = true;
			await act(async () => {
				root.render(<Tree tick={1} />);
				await flushMicrotasks();
			});

			const crossRenderWarning = consoleError.mock.calls.find((call) =>
				String(call[0]).includes("Cannot update a component"),
			);
			expect(crossRenderWarning).toBeUndefined();
		} finally {
			consoleError.mockRestore();
		}
	});
});
