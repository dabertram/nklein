import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NKLEIN_DEV_TEST_PROJECT_MARKER_PATH } from "../../../../src/nklein-agent/nklein-dev-test-project";
import {
	isJsonRecord,
	isMarkedDevTestWorkspaceEntry,
	listPlanArtifactDirectoryNames,
	pathExists,
	readEvidenceBundleBaseCommit,
	updateMigratedArtifactMetadata,
} from "../../../../src/trpc/projects-api-helpers";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "projects-api-helpers-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("isJsonRecord", () => {
	it("accepts plain objects only — not null, arrays, or primitives", () => {
		expect(isJsonRecord({})).toBe(true);
		expect(isJsonRecord({ a: 1 })).toBe(true);
		expect(isJsonRecord(null)).toBe(false);
		expect(isJsonRecord([])).toBe(false);
		expect(isJsonRecord([{ a: 1 }])).toBe(false);
		expect(isJsonRecord("x")).toBe(false);
		expect(isJsonRecord(42)).toBe(false);
		expect(isJsonRecord(undefined)).toBe(false);
	});
});

describe("pathExists", () => {
	it("is true for an existing path and false for a missing one", async () => {
		const file = join(dir, "here.txt");
		await writeFile(file, "x", "utf8");
		expect(await pathExists(file)).toBe(true);
		expect(await pathExists(dir)).toBe(true); // directories count
		expect(await pathExists(join(dir, "nope.txt"))).toBe(false);
	});
});

describe("readEvidenceBundleBaseCommit", () => {
	it("returns null for a blank/absent bundle path without touching the fs", async () => {
		expect(await readEvidenceBundleBaseCommit(null)).toBeNull();
		expect(await readEvidenceBundleBaseCommit(undefined)).toBeNull();
		expect(await readEvidenceBundleBaseCommit("   ")).toBeNull();
	});

	it("returns the baseCommit when the snapshot holds a valid hex sha", async () => {
		await writeFile(join(dir, "config-snapshot.json"), JSON.stringify({ baseCommit: "abc1234" }), "utf8");
		expect(await readEvidenceBundleBaseCommit(dir)).toBe("abc1234");
		await writeFile(
			join(dir, "config-snapshot.json"),
			JSON.stringify({ baseCommit: "  0123456789abcdef0123456789abcdef01234567  " }),
			"utf8",
		);
		expect(await readEvidenceBundleBaseCommit(dir)).toBe("0123456789abcdef0123456789abcdef01234567");
	});

	it("rejects a non-sha, too-short, too-long, or non-string baseCommit", async () => {
		for (const bad of ["nope", "abc12", "g".repeat(10), "0".repeat(41), 12345, null]) {
			await writeFile(join(dir, "config-snapshot.json"), JSON.stringify({ baseCommit: bad }), "utf8");
			expect(await readEvidenceBundleBaseCommit(dir)).toBeNull();
		}
	});

	it("returns null when the snapshot file is missing or unparseable", async () => {
		expect(await readEvidenceBundleBaseCommit(dir)).toBeNull(); // no file written
		await writeFile(join(dir, "config-snapshot.json"), "{ not json", "utf8");
		expect(await readEvidenceBundleBaseCommit(dir)).toBeNull();
	});
});

describe("isMarkedDevTestWorkspaceEntry", () => {
	const writeMarker = async (createdBy: unknown) => {
		const markerPath = join(dir, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH);
		await mkdir(join(markerPath, ".."), { recursive: true });
		await writeFile(markerPath, JSON.stringify({ createdBy }), "utf8");
	};

	it("short-circuits to false when the repo was not created by kanban (no fs read)", async () => {
		await writeMarker("nklein-dev-test");
		expect(
			await isMarkedDevTestWorkspaceEntry({
				workspaceId: "w",
				repoPath: dir,
				gitRepositoryCreatedByKanban: false,
			}),
		).toBe(false);
	});

	it("is true only when the marker's createdBy is exactly the dev-test sentinel", async () => {
		await writeMarker("nklein-dev-test");
		expect(
			await isMarkedDevTestWorkspaceEntry({ workspaceId: "w", repoPath: dir, gitRepositoryCreatedByKanban: true }),
		).toBe(true);
	});

	it("is false for a foreign createdBy, missing marker, or unparseable marker", async () => {
		const entry = { workspaceId: "w", repoPath: dir, gitRepositoryCreatedByKanban: true };
		await writeMarker("someone-else");
		expect(await isMarkedDevTestWorkspaceEntry(entry)).toBe(false);

		await rm(join(dir, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH), { force: true });
		expect(await isMarkedDevTestWorkspaceEntry(entry)).toBe(false); // marker gone

		await mkdir(join(dir, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH, ".."), { recursive: true });
		await writeFile(join(dir, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH), "{ broken", "utf8");
		expect(await isMarkedDevTestWorkspaceEntry(entry)).toBe(false); // unparseable
	});
});

describe("listPlanArtifactDirectoryNames", () => {
	it("returns only subdirectory names, sorted, and ignores plain files", async () => {
		const plans = join(dir, ".nklein", "nklein", "plans");
		await mkdir(join(plans, "charlie"), { recursive: true });
		await mkdir(join(plans, "alpha"), { recursive: true });
		await mkdir(join(plans, "bravo"), { recursive: true });
		await writeFile(join(plans, "loose-file.json"), "{}", "utf8");
		expect(await listPlanArtifactDirectoryNames(dir)).toEqual(["alpha", "bravo", "charlie"]);
	});

	it("returns [] when the plans directory does not exist", async () => {
		expect(await listPlanArtifactDirectoryNames(dir)).toEqual([]);
	});
});

describe("updateMigratedArtifactMetadata", () => {
	const readMeta = async (artifactPath: string) =>
		JSON.parse(await readFile(join(artifactPath, "artifact.json"), "utf8")) as Record<string, unknown>;

	it("rebinds workspace fields and stamps updatedAt while preserving other fields", async () => {
		await writeFile(
			join(dir, "artifact.json"),
			JSON.stringify({ workspaceId: "old", workspacePath: "/old", title: "keep me", sourceTaskId: "" }),
			"utf8",
		);
		await updateMigratedArtifactMetadata({
			artifactPath: dir,
			parentWorkspaceId: "new-ws",
			parentWorkspacePath: "/new/path",
			sourceTaskId: "task-42",
		});
		const meta = await readMeta(dir);
		expect(meta.workspaceId).toBe("new-ws");
		expect(meta.workspacePath).toBe("/new/path");
		expect(meta.title).toBe("keep me");
		expect(meta.sourceTaskId).toBe("task-42"); // blank existing → falls back to the supplied source
		expect(typeof meta.updatedAt).toBe("number");
		expect(meta.updatedAt as number).toBeGreaterThan(0);
	});

	it("keeps an already-set sourceTaskId instead of overwriting it", async () => {
		await writeFile(join(dir, "artifact.json"), JSON.stringify({ sourceTaskId: "original" }), "utf8");
		await updateMigratedArtifactMetadata({
			artifactPath: dir,
			parentWorkspaceId: "ws",
			parentWorkspacePath: "/p",
			sourceTaskId: "would-replace",
		});
		expect((await readMeta(dir)).sourceTaskId).toBe("original");
	});

	it("is a no-op (no throw, no file created) when the metadata file is missing or not a JSON object", async () => {
		await expect(
			updateMigratedArtifactMetadata({
				artifactPath: dir,
				parentWorkspaceId: "ws",
				parentWorkspacePath: "/p",
				sourceTaskId: null,
			}),
		).resolves.toBeUndefined();
		expect(await pathExists(join(dir, "artifact.json"))).toBe(false); // nothing written

		await writeFile(join(dir, "artifact.json"), JSON.stringify([1, 2, 3]), "utf8"); // valid JSON, not a record
		await updateMigratedArtifactMetadata({
			artifactPath: dir,
			parentWorkspaceId: "ws",
			parentWorkspacePath: "/p",
			sourceTaskId: null,
		});
		expect(await readFile(join(dir, "artifact.json"), "utf8")).toBe("[1,2,3]"); // untouched
	});
});
