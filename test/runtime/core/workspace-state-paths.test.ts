import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	BOARD_FILENAME,
	getWorkspaceBoardPath,
	getWorkspaceDirectoryLockRequest,
	getWorkspaceDirectoryPath,
	getWorkspaceIndexLockRequest,
	getWorkspaceIndexPath,
	getWorkspaceLocalBoardPath,
	getWorkspaceLocalStateDirectoryPath,
	getWorkspaceMetaPath,
	getWorkspaceSessionsPath,
	getWorkspacesRootPath,
	INDEX_FILENAME,
	META_FILENAME,
	SESSIONS_FILENAME,
} from "../../../src/state/workspace-state-paths";

describe("workspace-state-paths (§5.U layout)", () => {
	it("nests a workspace's board/sessions/meta under its directory under the workspaces root", () => {
		const root = getWorkspacesRootPath();
		const dir = getWorkspaceDirectoryPath("ws-1");
		expect(dir).toBe(join(root, "ws-1"));
		expect(getWorkspaceBoardPath("ws-1")).toBe(join(dir, BOARD_FILENAME));
		expect(getWorkspaceSessionsPath("ws-1")).toBe(join(dir, SESSIONS_FILENAME));
		expect(getWorkspaceMetaPath("ws-1")).toBe(join(dir, META_FILENAME));
		expect(getWorkspaceIndexPath()).toBe(join(root, INDEX_FILENAME));
	});

	it("places a repo's local state under <repo>/.nklein/.../workspace", () => {
		const localDir = getWorkspaceLocalStateDirectoryPath("/repo/x");
		expect(localDir.startsWith(`${join("/repo/x", ".nklein")}`)).toBe(true);
		expect(localDir.endsWith(join("workspace"))).toBe(true);
		expect(getWorkspaceLocalBoardPath("/repo/x")).toBe(join(localDir, BOARD_FILENAME));
	});

	it("builds a file lock for the index and a directory lock (with sibling lockfile) for a workspace dir", () => {
		expect(getWorkspaceIndexLockRequest()).toEqual({ path: getWorkspaceIndexPath(), type: "file" });
		const dirLock = getWorkspaceDirectoryLockRequest("ws-1");
		expect(dirLock.type).toBe("directory");
		expect(dirLock.path).toBe(getWorkspaceDirectoryPath("ws-1"));
		expect(dirLock.lockfilePath).toBe(join(getWorkspacesRootPath(), "ws-1.lock"));
	});
});
