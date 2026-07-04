import { describe, expect, it } from "vitest";
import {
	redactWorkspacePathForAgent,
	toWorkspaceRelativeArtifactPath,
} from "../../../src/nklein-agent/decomposition/plan-artifact-apply";

// These two exported helpers are the agent-facing host-path scrubbers (AGENTS.md: "agents must never see host details").
// POSIX separators are used throughout — vitest runs on darwin/linux where path.sep is "/".

describe("toWorkspaceRelativeArtifactPath", () => {
	it("relativizes a host artifact path against the workspace root", () => {
		expect(toWorkspaceRelativeArtifactPath("/ws", "/ws/.nklein/nklein/plans/p.md")).toBe(".nklein/nklein/plans/p.md");
	});

	it("handles a deeper workspace root", () => {
		expect(toWorkspaceRelativeArtifactPath("/home/u/proj", "/home/u/proj/a/b.txt")).toBe("a/b.txt");
	});

	it("expresses a path outside the workspace with .. rather than leaking the absolute path", () => {
		expect(toWorkspaceRelativeArtifactPath("/ws", "/other/x.md")).toBe("../other/x.md");
	});
});

describe("redactWorkspacePathForAgent", () => {
	it("strips a '<workspace>/' prefix down to the workspace-relative path", () => {
		expect(redactWorkspacePathForAgent("/ws", "failed at /ws/src/a.ts")).toBe("failed at src/a.ts");
	});

	it("rewrites a bare workspace mention to the sandbox root '.'", () => {
		expect(redactWorkspacePathForAgent("/ws", "cwd is /ws now")).toBe("cwd is . now");
	});

	it("redacts every occurrence in the message", () => {
		expect(redactWorkspacePathForAgent("/ws", "/ws/a and /ws/b")).toBe("a and b");
	});

	it("leaves text without the workspace path untouched", () => {
		expect(redactWorkspacePathForAgent("/ws", "no host path here")).toBe("no host path here");
	});

	it("returns the text unchanged when no workspace path is provided", () => {
		expect(redactWorkspacePathForAgent("", "/ws/a")).toBe("/ws/a");
	});

	it("does NOT mangle a sibling path that merely shares the workspace prefix", () => {
		// The bare-path rewrite must fire only on a whole path token, never mid-segment. Before the
		// right-boundary guard, "/ws" matched inside "/wsconfig.json" → ".config.json", corrupting
		// unrelated sibling paths embedded in agent-facing error text.
		expect(redactWorkspacePathForAgent("/ws", "error: /wsconfig.json not found")).toBe(
			"error: /wsconfig.json not found",
		);
		expect(redactWorkspacePathForAgent("/ws", "see /ws-backup/a.ts")).toBe("see /ws-backup/a.ts");
		expect(redactWorkspacePathForAgent("/home/u/kanban", "moved to /home/u/kanban-old")).toBe(
			"moved to /home/u/kanban-old",
		);
	});

	it("still rewrites a bare workspace path at end-of-string", () => {
		expect(redactWorkspacePathForAgent("/ws", "ran in /ws")).toBe("ran in .");
	});
});
