import { describe, expect, it } from "vitest";
import {
	INDEX_VERSION,
	workspaceIndexEntrySchema,
	workspaceIndexFileSchema,
	workspaceLocalIdentitySchema,
	workspaceSessionsSchema,
	workspaceStateMetaSchema,
} from "../../../src/state/workspace-state-schema";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The workspace index stores one relation TWICE — `entries` keyed by workspace id, and `repoPathToId` keyed by
 * repo path — and the `superRefine` is what keeps the two views agreeing. That matters more than a shape check:
 * a workspace whose two views disagree resolves to the WRONG repo path, so a card runs against a project the
 * user did not open. Nothing downstream can notice, because both sides are individually well-formed.
 *
 * The check runs in both directions, and the tests below isolate them, because **each direction catches a
 * corruption the other cannot see**: entries→mapping catches an entry with no mapping at all, mapping→entries
 * catches an ORPHAN mapping pointing at a workspace that does not exist. Either one alone would let the other
 * corruption through while looking like a complete consistency check.
 */
const entry = (workspaceId: string, repoPath: string) => ({ workspaceId, repoPath, autoResumeEnabled: false });

const validIndex = (): {
	version: number;
	entries: Record<string, ReturnType<typeof entry>>;
	repoPathToId: Record<string, string>;
} => ({
	version: INDEX_VERSION,
	entries: { "ws-1": entry("ws-1", "/repo/one"), "ws-2": entry("ws-2", "/repo/two") },
	repoPathToId: { "/repo/one": "ws-1", "/repo/two": "ws-2" },
});

function failureAt(index: unknown): string[] {
	const result = workspaceIndexFileSchema.safeParse(index);
	expect(result.success, "expected this index to be rejected").toBe(false);
	return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("the index's two views must agree", () => {
	it("accepts a consistent index", () => {
		expect(workspaceIndexFileSchema.safeParse(validIndex()).success).toBe(true);
	});

	it("rejects an entry whose workspaceId disagrees with its own KEY", () => {
		// The record key is what every lookup uses; an entry claiming a different id is a workspace that answers
		// to one name and reports another.
		const index = validIndex();
		(index.entries["ws-1"] as { workspaceId: string }).workspaceId = "ws-9";

		expect(failureAt(index)).toContain("entries.ws-1.workspaceId");
	});

	it("rejects an entry with NO mapping — the corruption only the entries→mapping direction sees", () => {
		const index = validIndex();
		delete index.repoPathToId["/repo/one"];

		expect(failureAt(index)).toContain("entries.ws-1.repoPath");
	});

	it("rejects an ORPHAN mapping — the corruption only the mapping→entries direction sees", () => {
		// Nothing in the entries half is wrong here, so a one-directional check would call this index healthy and
		// leave a path resolving to a workspace that does not exist.
		const index = validIndex();
		index.repoPathToId["/repo/ghost"] = "ws-gone";

		expect(failureAt(index)).toContain("repoPathToId./repo/ghost");
	});

	it("rejects a mapping that points at a real workspace with a DIFFERENT path", () => {
		// The subtlest of the three: both halves exist and both are well-formed, and following the map lands on a
		// workspace whose repo is somewhere else entirely. This is the case that opens the wrong project.
		const index = validIndex();
		index.repoPathToId["/repo/one"] = "ws-2";

		const paths = failureAt(index);
		expect(paths).toContain("repoPathToId./repo/one");
	});

	it("names the offending workspace in the message, not just the path", () => {
		// A corrupt index is repaired by hand; a message that says only "invalid" leaves the operator to diff two
		// records themselves.
		const index = validIndex();
		delete index.repoPathToId["/repo/one"];
		const result = workspaceIndexFileSchema.safeParse(index);

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/\/repo\/one.*ws-1/);
	});

	it("accepts an empty index — a first run is consistent, not corrupt", () => {
		expect(
			workspaceIndexFileSchema.safeParse({ version: INDEX_VERSION, entries: {}, repoPathToId: {} }).success,
		).toBe(true);
	});
});

describe("the version is a migration boundary", () => {
	it("rejects an older index rather than reading it as current", () => {
		// A v1 file read as v2 would be interpreted under the wrong layout and then written back in that shape,
		// destroying it. Refusing is what makes a migration possible at all.
		const index = { ...validIndex(), version: 1 };

		expect(workspaceIndexFileSchema.safeParse(index).success).toBe(false);
	});

	it("rejects a FUTURE version too", () => {
		// A newer runtime's file must not be silently downgraded by an older one.
		const index = { ...validIndex(), version: INDEX_VERSION + 1 };

		expect(workspaceIndexFileSchema.safeParse(index).success).toBe(false);
	});
});

describe("index entries", () => {
	it("requires a non-empty workspace id and repo path", () => {
		// An empty string is a valid string and a useless identifier; it would key a record nothing can find.
		expect(workspaceIndexEntrySchema.safeParse(entry("", "/repo")).success).toBe(false);
		expect(workspaceIndexEntrySchema.safeParse(entry("ws-1", "")).success).toBe(false);
	});

	it("requires autoResumeEnabled to be stated, not inferred", () => {
		// Auto-resume restarts work without a human present. A missing field defaulting either way is a decision
		// nobody made; requiring it forces the writer to say.
		expect(workspaceIndexEntrySchema.safeParse({ workspaceId: "ws-1", repoPath: "/repo" }).success).toBe(false);
	});

	it("leaves the descriptive fields optional", () => {
		const parsed = workspaceIndexEntrySchema.safeParse(entry("ws-1", "/repo"));

		expect(parsed.success).toBe(true);
		if (!parsed.success) return;
		expect(parsed.data.displayName).toBeUndefined();
		expect(parsed.data.selfProjectConfirmed).toBeUndefined();
	});
});

describe("sessions are keyed by the task they belong to", () => {
	const session = (taskId: string) => ({
		taskId,
		state: "running" as const,
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: 1,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
	});

	it("accepts a record whose keys match their sessions", () => {
		expect(workspaceSessionsSchema.safeParse({ "task-1": session("task-1") }).success).toBe(true);
	});

	it("rejects a session filed under another task's key", () => {
		// The key is what a lookup uses and the field is what the session reports; a mismatch attributes one
		// card's live session to another, so a stop or a resume reaches the wrong card.
		const result = workspaceSessionsSchema.safeParse({ "task-1": session("task-2") });

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.path.join(".")).toBe("task-1.taskId");
	});

	it("accepts an empty session record", () => {
		expect(workspaceSessionsSchema.safeParse({}).success).toBe(true);
	});
});

describe("the smaller records", () => {
	it("pins the local identity to version 1, with both fields present", () => {
		const identity = { version: 1 as const, workspaceId: "ws-1", repoPath: "/repo", updatedAt: 5 };

		expect(workspaceLocalIdentitySchema.safeParse(identity).success).toBe(true);
		expect(workspaceLocalIdentitySchema.safeParse({ ...identity, version: 2 }).success).toBe(false);
		expect(workspaceLocalIdentitySchema.safeParse({ ...identity, workspaceId: "" }).success).toBe(false);
		expect(workspaceLocalIdentitySchema.safeParse({ ...identity, repoPath: "" }).success).toBe(false);
	});

	it("requires the state revision to be a non-negative integer", () => {
		// The revision is an optimistic-concurrency counter. A fractional or negative value would compare in ways
		// no writer intends, so a stale write could look newer than the state it is overwriting.
		expect(workspaceStateMetaSchema.safeParse({ revision: 0, updatedAt: 1 }).success).toBe(true);
		expect(workspaceStateMetaSchema.safeParse({ revision: -1, updatedAt: 1 }).success).toBe(false);
		expect(workspaceStateMetaSchema.safeParse({ revision: 1.5, updatedAt: 1 }).success).toBe(false);
	});
});
