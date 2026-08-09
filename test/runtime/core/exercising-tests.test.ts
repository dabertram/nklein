import { describe, expect, it } from "vitest";
import { conventionalTestPath, resolveExercisingTests } from "../../../src/core/exercising-tests";

/**
 * The pairing rule, extracted so `scripts/ablate.mts` and the P20.3b delivery seam give the SAME answer.
 *
 * The property that matters is not the happy path — it is that "no test names this path" must never be
 * reported as "nothing exercises this module". An early sweep did exactly that and announced 144 untested
 * modules when 6 of the first 8 were tested under a different filename; a later one announced 14 when 12 were
 * reached through a barrel. Both numbers were real measurements of a narrower question than their label.
 *
 * IO is injected, so the rule is tested without a filesystem and both callers share it rather than each
 * carrying a copy that can drift.
 */
const noFiles = { fileExists: () => false, findImportingTests: () => [] };

describe("the conventional path", () => {
	it("maps a source module to its mirrored test path", () => {
		expect(conventionalTestPath("src/core/foo.ts")).toBe("test/runtime/core/foo.test.ts");
		expect(conventionalTestPath("src/nklein-agent/deep/bar.ts")).toBe("test/runtime/nklein-agent/deep/bar.test.ts");
	});

	it("returns null for anything not a src TypeScript module", () => {
		// A caller passing a test file or a doc should get "no convention", not a nonsense path it then probes for.
		for (const path of ["test/runtime/core/foo.test.ts", "README.md", "src/core/foo.js", "scripts/x.mts"]) {
			expect(conventionalTestPath(path), path).toBeNull();
		}
	});
});

describe("resolving what exercises a module", () => {
	it("prefers the conventional test when it exists, without searching", async () => {
		let searched = false;
		const result = await resolveExercisingTests("src/core/foo.ts", {
			fileExists: (path) => path === "test/runtime/core/foo.test.ts",
			findImportingTests: () => {
				searched = true;
				return [];
			},
		});

		expect(result).toEqual(["test/runtime/core/foo.test.ts"]);
		expect(searched, "the grep is the expensive path and must be skipped on a hit").toBe(false);
	});

	it("falls back to whatever IMPORTS the module — the case the convention gets wrong", async () => {
		// The 144-vs-6 lesson: a module tested under a different filename is exercised, and reporting it
		// unexercised is a false gap that someone then tries to close.
		const result = await resolveExercisingTests("src/core/foo.ts", {
			fileExists: () => false,
			findImportingTests: () => ["test/runtime/other-name.test.ts", "test/runtime/second.test.ts"],
		});

		expect(result).toEqual(["test/runtime/other-name.test.ts", "test/runtime/second.test.ts"]);
	});

	it("searches for a QUOTED specifier, so a prefix cannot match a longer sibling", async () => {
		// Without the trailing quote, `core/task-result-branch` matches every importer of
		// `core/task-result-branch-naming`, and the pairing silently widens to tests of a different module.
		let seen = "";
		await resolveExercisingTests("src/core/task-result-branch.ts", {
			fileExists: () => false,
			findImportingTests: (specifier) => {
				seen = specifier;
				return [];
			},
		});

		expect(seen).toBe('core/task-result-branch"');
	});

	it("keeps only .test.ts results from the search", async () => {
		// grep -rl over `test/` also returns fixtures, snapshots and helper modules; a selection containing one
		// would make vitest collect nothing and the run would look like a shrunken selection.
		const result = await resolveExercisingTests("src/core/foo.ts", {
			fileExists: () => false,
			findImportingTests: () => ["test/runtime/a.test.ts", "test/fixtures/thing.json", "test/helpers/setup.ts", ""],
		});

		expect(result).toEqual(["test/runtime/a.test.ts"]);
	});

	it("returns EMPTY when nothing exercises it — the only honest way to say that", async () => {
		expect(await resolveExercisingTests("src/core/orphan.ts", noFiles)).toEqual([]);
	});

	it("returns empty for a path with no convention, without searching", async () => {
		let searched = false;
		const result = await resolveExercisingTests("README.md", {
			fileExists: () => false,
			findImportingTests: () => {
				searched = true;
				return [];
			},
		});

		expect(result).toEqual([]);
		expect(searched).toBe(false);
	});

	it("awaits async IO, so a real filesystem lookup is usable unchanged", async () => {
		const result = await resolveExercisingTests("src/core/foo.ts", {
			fileExists: async () => false,
			findImportingTests: async () => ["test/runtime/async.test.ts"],
		});

		expect(result).toEqual(["test/runtime/async.test.ts"]);
	});
});
