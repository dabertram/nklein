import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMonorepoScanMemo, scanMonorepoFacts } from "../../../src/nklein-agent/nklein-monorepo-scope-scan";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * One bounded walk per workspace, feeding the pure scope derivation. Two things make it worth pinning rather
 * than trusting: the skip list, and the memo.
 *
 * The skip list is not an optimisation. A real monorepo's `node_modules` holds thousands of `package.json`
 * files, and a walk that descends into it does not return a slow answer — it returns a WRONG one, in which every
 * dependency looks like a workspace package and the card's scope becomes the whole dependency tree.
 *
 * The memo means the SECOND caller gets the first caller's answer. That is the point (one walk serves every card
 * start) and also the sharp edge: a package added after the first scan stays invisible until the memo is
 * cleared. Pinned in both directions so the trade-off is stated rather than discovered.
 */
let workspace: string;

function touch(relativePath: string): void {
	const full = join(workspace, relativePath);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, "{}");
}

beforeEach(() => {
	clearMonorepoScanMemo();
	workspace = mkdtempSync(join(tmpdir(), "nklein-monorepo-scan-"));
});

afterEach(() => {
	clearMonorepoScanMemo();
	rmSync(workspace, { force: true, recursive: true });
});

describe("what the walk finds", () => {
	it('reports a root package as "" and nested packages by relative path', async () => {
		touch("package.json");
		touch("packages/api/package.json");
		touch("packages/web/package.json");

		const facts = await scanMonorepoFacts(workspace);

		expect([...facts.packageDirs].sort()).toEqual(["", "packages/api", "packages/web"]);
	});

	it("collects AGENTS.md and CLAUDE.md wherever they sit", async () => {
		touch("AGENTS.md");
		touch("packages/api/CLAUDE.md");

		const facts = await scanMonorepoFacts(workspace);

		expect([...facts.instructionFiles].sort()).toEqual(["AGENTS.md", "packages/api/CLAUDE.md"]);
	});

	it("matches instruction files by EXACT name, not case-insensitively", async () => {
		// The convention is the uppercase name; matching loosely would sweep up unrelated docs and feed them to a
		// model as instructions.
		touch("agents.md");
		touch("Claude.MD");
		touch("readme.md");

		expect((await scanMonorepoFacts(workspace)).instructionFiles).toEqual([]);
	});

	it("returns empty facts for a workspace that does not exist, rather than throwing", async () => {
		// Best-effort by contract: a card start must not fail because a tree was unreadable.
		const facts = await scanMonorepoFacts(join(workspace, "no-such-dir"));

		expect(facts).toEqual({ packageDirs: [], instructionFiles: [] });
	});

	it("returns empty facts for an empty workspace", async () => {
		expect(await scanMonorepoFacts(workspace)).toEqual({ packageDirs: [], instructionFiles: [] });
	});
});

describe("the skip list", () => {
	it("does NOT descend into node_modules", async () => {
		// THE probe. Without this the scan does not merely run slowly — every dependency's package.json is reported
		// as a workspace package, and the card's scope becomes the entire dependency tree.
		touch("package.json");
		touch("node_modules/left-pad/package.json");
		touch("node_modules/react/package.json");
		touch("node_modules/react/AGENTS.md");

		const facts = await scanMonorepoFacts(workspace);

		expect(facts.packageDirs).toEqual([""]);
		expect(facts.instructionFiles).toEqual([]);
	});

	it("skips build output and VCS directories too", async () => {
		// Build output contains COPIES of real package.json files, so descending would report the same package
		// twice under two different paths.
		for (const skipped of ["dist", "build", "coverage", ".git", ".nklein"]) {
			touch(`${skipped}/package.json`);
		}
		touch("package.json");

		expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual([""]);
	});

	it("skips every dot-directory, not only the ones named in the list", async () => {
		touch(".cache/package.json");
		touch(".venv/package.json");

		expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual([]);
	});

	it("does not skip a directory whose name merely CONTAINS a skipped name", async () => {
		// `dist` is skipped; `distribution` is a plausible real package directory and must survive.
		touch("distribution/package.json");
		touch("my-node_modules/package.json");

		expect([...(await scanMonorepoFacts(workspace)).packageDirs].sort()).toEqual(["distribution", "my-node_modules"]);
	});
});

describe("the depth bound", () => {
	it("finds a package four levels down", async () => {
		touch("a/b/c/d/package.json");

		expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual(["a/b/c/d"]);
	});

	it("does NOT find a package five levels down", async () => {
		// The bound is real and this is where it bites. Stated as a test so that raising it is a deliberate act
		// with a visible cost, rather than something discovered by a card whose package was silently invisible.
		touch("a/b/c/d/e/package.json");

		expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual([]);
	});
});

describe("the memo", () => {
	it("returns the SAME facts object on a second call — one walk serves every card start", async () => {
		touch("package.json");
		const first = await scanMonorepoFacts(workspace);
		const second = await scanMonorepoFacts(workspace);

		expect(second).toBe(first);
	});

	it("does not see a package added after the first scan", async () => {
		// The sharp edge of the memo, pinned deliberately: this is a real staleness window, and someone debugging
		// "why is my new package invisible" should find the answer written down rather than have to derive it.
		touch("package.json");
		await scanMonorepoFacts(workspace);
		touch("packages/new/package.json");

		expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual([""]);
	});

	it("sees it once the memo is cleared", async () => {
		touch("package.json");
		await scanMonorepoFacts(workspace);
		touch("packages/new/package.json");
		clearMonorepoScanMemo();

		expect([...(await scanMonorepoFacts(workspace)).packageDirs].sort()).toEqual(["", "packages/new"]);
	});

	it("keys the memo per workspace, so one project's facts never answer for another", async () => {
		// A cache shared across workspaces would hand a card the wrong project's package layout — a failure that
		// looks like a scoping bug rather than a caching one.
		touch("package.json");
		const other = mkdtempSync(join(tmpdir(), "nklein-monorepo-scan-other-"));
		try {
			mkdirSync(join(other, "svc"), { recursive: true });
			writeFileSync(join(other, "svc", "package.json"), "{}");

			expect((await scanMonorepoFacts(workspace)).packageDirs).toEqual([""]);
			expect((await scanMonorepoFacts(other)).packageDirs).toEqual(["svc"]);
		} finally {
			rmSync(other, { force: true, recursive: true });
		}
	});

	it("memoizes an EMPTY result too, including for an unreadable tree", async () => {
		// Otherwise a missing workspace is re-walked on every card start, which is the case most likely to repeat.
		const missing = join(workspace, "gone");
		expect(await scanMonorepoFacts(missing)).toBe(await scanMonorepoFacts(missing));
	});
});
