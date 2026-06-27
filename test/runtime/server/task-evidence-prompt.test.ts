import { describe, expect, it } from "vitest";
import type {
	RuntimeBoardCard,
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileChange,
} from "../../../src/core/api-contract";
import {
	buildTaskEvidencePromptBlock,
	renderWorkspaceChangesEvidence,
} from "../../../src/trpc/runtime-api/task-evidence-prompt";

function file(over: Partial<RuntimeWorkspaceFileChange> = {}): RuntimeWorkspaceFileChange {
	return {
		path: "src/a.ts",
		status: "modified",
		additions: 3,
		deletions: 1,
		oldText: "old code",
		newText: "new code",
		...over,
	};
}

function changes(files: RuntimeWorkspaceFileChange[]): RuntimeWorkspaceChangesResponse {
	return { repoRoot: "/repo", generatedAt: 0, files };
}

function card(over: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard {
	return {
		id: "t1",
		title: "Fix the bug",
		prompt: "fix it",
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		...over,
	} as RuntimeBoardCard;
}

describe("renderWorkspaceChangesEvidence", () => {
	it("returns null for no changes", () => {
		expect(renderWorkspaceChangesEvidence(null)).toBeNull();
		expect(renderWorkspaceChangesEvidence(changes([]))).toBeNull();
	});

	it("renders a per-file diff preview with status, counts, and old/new bodies", () => {
		const out = renderWorkspaceChangesEvidence(changes([file()])) ?? "";
		expect(out).toContain("diff --nklein src/a.ts");
		expect(out).toContain("status: modified; additions: 3; deletions: 1");
		expect(out).toContain("--- old\nold code");
		expect(out).toContain("+++ new\nnew code");
	});

	it("omits old/new sections when their text is null and includes a rename's previous path", () => {
		const out =
			renderWorkspaceChangesEvidence(changes([file({ oldText: null, newText: null, previousPath: "src/b.ts" })])) ??
			"";
		expect(out).not.toContain("--- old");
		expect(out).not.toContain("+++ new");
		expect(out).toContain("previous: src/b.ts");
	});

	it("caps the preview at 20 files with an omitted-count footer", () => {
		const many = Array.from({ length: 21 }, (_, i) => file({ path: `src/f${i}.ts` }));
		const out = renderWorkspaceChangesEvidence(changes(many)) ?? "";
		expect(out).toContain("1 additional changed files omitted");
	});

	it("truncates an over-long file body with a marker", () => {
		const out = renderWorkspaceChangesEvidence(changes([file({ oldText: "x".repeat(5_000) })])) ?? "";
		expect(out).toContain("[truncated after 4,000 characters]");
	});
});

describe("buildTaskEvidencePromptBlock", () => {
	it("includes the bundle, workspace, task identity, and counts", () => {
		const block = buildTaskEvidencePromptBlock({
			task: card(),
			workspacePath: "/repo",
			taskCwd: "/repo/work",
			baseCommit: "abc123",
			bundlePath: "/evidence/bundle",
			transcriptCount: 4,
			changeCount: 7,
		});
		expect(block).toContain("Evidence bundle: /evidence/bundle");
		expect(block).toContain("Workspace: /repo");
		expect(block).toContain("Task: Fix the bug (t1)");
		expect(block).toContain("Base ref: main");
		expect(block).toContain("Base commit: abc123");
		expect(block).toContain("Transcript files: 4");
		expect(block).toContain("Changed files captured: 7");
	});

	it("falls back to the task id when the title is blank, and shows 'unknown' for a null base commit", () => {
		const block = buildTaskEvidencePromptBlock({
			task: card({ id: "t2", title: "" }),
			workspacePath: "/repo",
			taskCwd: "/repo/work",
			baseCommit: null,
			bundlePath: "/b",
			transcriptCount: 0,
			changeCount: 0,
		});
		expect(block).toContain("Task: t2 (t2)");
		expect(block).toContain("Base commit: unknown");
	});
});
