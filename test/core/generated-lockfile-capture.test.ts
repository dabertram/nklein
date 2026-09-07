import { describe, expect, it } from "vitest";
import {
	buildGeneratedLockfileRestoreCommand,
	parseGitNameStatusZ,
	selectGeneratedLockfilesToDrop,
} from "../../src/core/generated-lockfile-capture";

const change = (status: string, path: string) => ({ status, path });

describe("selectGeneratedLockfilesToDrop (P0.LOCKFILECAPTURE)", () => {
	it("drops a lockfile that npm install generated on a repo whose base has none (the v31 s09a1 branch)", () => {
		const drops = selectGeneratedLockfilesToDrop([change("A", "package-lock.json")]);
		expect(drops.map((drop) => drop.path)).toEqual(["package-lock.json"]);
		const [added] = drops;
		if (!added) {
			throw new Error("expected the generated lockfile to be dropped");
		}
		expect(buildGeneratedLockfileRestoreCommand(added, "main")).toEqual([
			"git",
			"rm",
			"-q",
			"--cached",
			"--",
			"package-lock.json",
		]);
	});

	it("keeps a lockfile whose manifest changed in the same patch — a dependency bump is authorship", () => {
		expect(selectGeneratedLockfilesToDrop([change("M", "package-lock.json"), change("M", "package.json")])).toEqual(
			[],
		);
		expect(selectGeneratedLockfilesToDrop([change("M", "Cargo.lock"), change("M", "Cargo.toml")])).toEqual([]);
		expect(selectGeneratedLockfilesToDrop([change("M", "Gemfile.lock"), change("M", "nklein.gemspec")])).toEqual([]);
	});

	it("is workspace-aware: a nested manifest change keeps the ROOT lockfile, a root manifest change does not keep a nested one", () => {
		expect(
			selectGeneratedLockfilesToDrop([change("M", "package-lock.json"), change("M", "packages/foo/package.json")]),
		).toEqual([]);
		const nested = selectGeneratedLockfilesToDrop([
			change("M", "packages/foo/package-lock.json"),
			change("M", "package.json"),
		]);
		expect(nested.map((drop) => drop.path)).toEqual(["packages/foo/package-lock.json"]);
	});

	it("restores a modified or deleted lockfile to the base's copy (HEAD when no base ref is known)", () => {
		const [modified] = selectGeneratedLockfilesToDrop([change("M", "go.sum"), change("M", "main.go")]);
		if (!modified) {
			throw new Error("expected go.sum to be dropped");
		}
		expect(buildGeneratedLockfileRestoreCommand(modified, "abc123")).toEqual([
			"git",
			"checkout",
			"-q",
			"abc123",
			"--",
			"go.sum",
		]);
		const [deleted] = selectGeneratedLockfilesToDrop([change("D", "poetry.lock")]);
		if (!deleted) {
			throw new Error("expected poetry.lock to be dropped");
		}
		expect(buildGeneratedLockfileRestoreCommand(deleted, null)).toEqual([
			"git",
			"checkout",
			"-q",
			"HEAD",
			"--",
			"poetry.lock",
		]);
	});

	it("never touches ordinary files or a manifest itself", () => {
		expect(
			selectGeneratedLockfilesToDrop([
				change("M", "package.json"),
				change("A", "src/lock.ts"),
				change("M", "README.md"),
			]),
		).toEqual([]);
	});
});

describe("parseGitNameStatusZ", () => {
	it("reads NUL-separated status/path records, including renames as destination + source deletion", () => {
		expect(
			parseGitNameStatusZ("A\0package-lock.json\0M\0src/a.ts\0R100\0old/package.json\0new/package.json\0"),
		).toEqual([
			{ status: "A", path: "package-lock.json" },
			{ status: "M", path: "src/a.ts" },
			{ status: "R100", path: "new/package.json" },
			{ status: "D", path: "old/package.json" },
		]);
	});

	it("ignores output that is not a name-status listing instead of throwing", () => {
		expect(parseGitNameStatusZ("diff --git a/README.md b/README.md\n")).toEqual([]);
		expect(parseGitNameStatusZ("")).toEqual([]);
		expect(parseGitNameStatusZ("M\0")).toEqual([]);
	});
});
