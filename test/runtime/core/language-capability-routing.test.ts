import { describe, expect, it } from "vitest";
import { detectLanguages, recommendModelFloor } from "../../../src/core/language-capability-routing";

describe("detectLanguages", () => {
	it("maps extensions to languages and tallies most-frequent first", () => {
		const tally = detectLanguages(["src/a.py", "src/b.py", "src/c.ts", "README.md", "data.json"]);
		expect(tally).toEqual([
			{ language: "python", files: 2 },
			{ language: "typescript", files: 1 },
		]);
	});

	it("ignores files with no recognised source extension", () => {
		expect(detectLanguages(["notes.md", "config.yaml", "Makefile", "dir.with.dots/"])).toEqual([]);
	});

	it("reads the extension from the basename, not a directory dot", () => {
		expect(detectLanguages(["my.module/handler.go"])).toEqual([{ language: "go", files: 1 }]);
	});

	it("breaks equal-count ties alphabetically for determinism", () => {
		const tally = detectLanguages(["a.rs", "b.go"]);
		expect(tally.map((t) => t.language)).toEqual(["go", "rust"]);
	});
});

describe("recommendModelFloor", () => {
	it("routes a single-file Python edit to the 7B floor", () => {
		const rec = recommendModelFloor({ filePaths: ["src/app.py"], taskType: "single-file-edit" });
		expect(rec.recommendedFloorB).toBe(7);
		expect(rec.dominantLanguage).toBe("python");
		expect(rec.reason).toContain("≥7B");
	});

	it("routes any Rust card to the 32B floor even when it looks easy (the Python cliff)", () => {
		const rec = recommendModelFloor({ filePaths: ["src/lib.rs"], taskType: "bug-fix" });
		expect(rec.recommendedFloorB).toBe(32);
		expect(rec.reason).toContain("rust language capability floor");
	});

	it("pins the floor to the strongest language even when it is a minority of touched files", () => {
		// 3 Python files + 1 Rust file → still 32B, because the Rust file must be edited correctly.
		const rec = recommendModelFloor({
			filePaths: ["a.py", "b.py", "c.py", "d.rs"],
			taskType: "single-file-edit",
		});
		expect(rec.dominantLanguage).toBe("python");
		expect(rec.languageFloorB).toBe(32);
		expect(rec.recommendedFloorB).toBe(32);
	});

	it("applies the task-shape floor (14B) for multi-file work on an otherwise-cheap language", () => {
		const rec = recommendModelFloor({ filePaths: ["a.py", "b.py"], taskType: "multi-file" });
		expect(rec.languageFloorB).toBe(7);
		expect(rec.taskTypeFloorB).toBe(14);
		expect(rec.recommendedFloorB).toBe(14);
		expect(rec.reason).toContain("multi-file task shape");
	});

	it("takes the higher of language vs task-shape floor (Rust refactor stays 32B)", () => {
		const rec = recommendModelFloor({ filePaths: ["x.rs"], taskType: "refactor" });
		expect(rec.recommendedFloorB).toBe(32); // max(32, 14)
		expect(rec.reason).toContain("rust language capability floor");
	});

	it("falls back to the 14B unknown floor when no source files are detected", () => {
		const rec = recommendModelFloor({ filePaths: ["spec.md"], taskType: "single-file-edit" });
		expect(rec.dominantLanguage).toBe("unknown");
		expect(rec.recommendedFloorB).toBe(14);
		expect(rec.reason).toContain("no source files detected");
	});

	it("defaults to single-file-edit (no task-shape floor) when taskType is omitted", () => {
		const rec = recommendModelFloor({ filePaths: ["a.js"] });
		expect(rec.taskTypeFloorB).toBe(0);
		expect(rec.recommendedFloorB).toBe(7);
	});
});

describe("P22.1 — the size floor is labelled a weak prior, not a capability verdict", () => {
	it("carries the measured-fitness-overrides caveat in the reason of any real floor", () => {
		const rec = recommendModelFloor({ filePaths: ["src/main.rs"], taskType: "single-file-edit" });
		expect(rec.recommendedFloorB).toBeGreaterThan(0);
		expect(rec.reason).toContain("WEAK SIZE PRIOR");
		expect(rec.reason).toContain("measured fitness overrides");
		expect(rec.weakSizePrior).toBe(true);
	});

	it("carries the caveat across every floor tier — there is always a floor to over-read", () => {
		// Finding 2026-07-20: no language floor is below 7 (Python/JS/TS) and the unknown/no-file fallback is 14, so
		// `recommendedFloorB` is ALWAYS ≥ 7 — the `=== 0` "no floor" branch is unreachable (noted in P22.1). The
		// caveat is therefore always present, which is correct: a size floor is always a size prior.
		for (const paths of [["a.py"], ["a.rs"], [], ["a.java"]]) {
			const rec = recommendModelFloor({ filePaths: paths, taskType: "single-file-edit" });
			expect(rec.recommendedFloorB).toBeGreaterThan(0);
			expect(rec.reason).toContain("WEAK SIZE PRIOR");
			expect(rec.weakSizePrior).toBe(true);
		}
	});
});
