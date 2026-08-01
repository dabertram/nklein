import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	classifyEditFailure,
	type EditFailureKind,
	isEditFormatSkillFailure,
	summarizeEditFailures,
} from "../../../src/core/edit-failure-kind";

/**
 * P21.1 step 2 — separate the edit-FORMAT failure from every other reason an edit was refused.
 *
 * Step 1's coarse rate answers "does this model struggle to edit". Aider's result is narrower and actionable:
 * Qwen2.5-Coder-32B scores 16.4% with `whole` against 8.0% with `diff` — a 2× swing from format alone, on this
 * project's target model class. Routing a weak model to whole-file edits needs the format signal specifically, and
 * `is_error` cannot supply it.
 */

const EDIT_TOOL_PATH = "src/nklein-agent/nklein-edit-file-tool.ts";

/**
 * Every `Blocked edit_file:` message in the tool's source, with `${...}` interpolations replaced by `1`.
 *
 * The substitution is what makes the ratchet real: five of the seven sites BEGIN with an interpolation, so a
 * naive `[^`$]` capture saw only two of them and the ratchet passed over most of what it claims to cover —
 * a vacuous guard, which is the failure mode this whole file is about.
 */
function blockSiteTexts(source: string): string[] {
	return [...source.matchAll(/`Blocked edit_file: ([^`]+)`/gu)]
		.map((match) => (match[1] as string).replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/gu, "1"))
		.map((text) => text.trim())
		.filter((text) => text.length > 0);
}

describe("classifyEditFailure", () => {
	it("calls a non-matching search block a CONTEXT MISMATCH — the one format signal", () => {
		expect(classifyEditFailure("Blocked edit_file: edit block 2 did not match src/a.ts.")).toBe("context_mismatch");
	});

	it("does NOT count the six guards as format failures", () => {
		// A secret-scanner block is arguably the model editing correctly and failing policy. Counting these as
		// format failures inflates exactly the number this module exists to measure.
		const guards: [string, EditFailureKind][] = [
			["Blocked edit_file: the edit would break src/a.ts — unbalanced brace.", "syntax_guard"],
			[
				"Blocked edit_file: the edit would grow src/a.ts to 9000 lines, exceeding the 4000-line hard backstop",
				"size_guard",
			],
			["Blocked edit_file: potential AWS access key detected in src/a.ts.", "secret_guard"],
			["Blocked edit_file: Path escapes the workspace: ../../etc/passwd", "path_guard"],
			[
				"Blocked edit_file: Absolute path is outside the workspace. Use a path relative to the workspace root.",
				"path_guard",
			],
			["Blocked edit_file: src/a.ts could not be read. Use write_file to create a new file", "file_unreadable"],
		];
		for (const [message, kind] of guards) {
			expect(classifyEditFailure(message), message).toBe(kind);
			expect(isEditFormatSkillFailure(classifyEditFailure(message)), message).toBe(false);
		}
	});

	it("sees through the sandbox-tool JSON ENVELOPE the ledger actually stores", () => {
		// Taken from David's live ledger: the refusal is nested inside a tool-failure envelope, itself inside a
		// JSON string. Classification is a substring match and survives that, but it is pinned here because the
		// envelope is what real data looks like — the bare message only ever appears in tests.
		const real =
			'{"error":"Sandbox tool kanbanExtraTool failed.\n{"ok":false,"error":"Blocked edit_file: edit block 2 did not match src/index.ts."}"}';
		expect(classifyEditFailure(real)).toBe("context_mismatch");
	});

	it("classifies WITHOUT the prefix too — the ledger may not preserve it", () => {
		expect(classifyEditFailure("edit block 1 did not match src/a.ts.")).toBe("context_mismatch");
	});

	it("returns UNKNOWN rather than guessing, and never folds it into a real kind", () => {
		// An unrecognised failure counted as context_mismatch would inflate the format number directly.
		for (const message of ["", "   ", null, undefined, "Blocked edit_file: something new nobody classified yet"]) {
			expect(classifyEditFailure(message), String(message)).toBe("unknown");
			expect(isEditFormatSkillFailure("unknown")).toBe(false);
		}
	});

	it("prefers the SPECIFIC guard when two patterns could both plausibly match", () => {
		// "the edit would break" and "the edit would grow" share a prefix; ordering decides, so it is pinned.
		expect(classifyEditFailure("Blocked edit_file: the edit would break a.ts — unbalanced brace.")).toBe(
			"syntax_guard",
		);
	});
});

describe("summarizeEditFailures", () => {
	it("reports the format numerator separately from the guards", () => {
		const report = summarizeEditFailures([
			"edit block 1 did not match a.ts",
			"edit block 3 did not match b.ts",
			"potential token detected in c.ts",
			"d.ts could not be read",
		]);
		expect(report.formatSkillFailures).toBe(2);
		expect(report.byKind.secret_guard).toBe(1);
		expect(report.byKind.file_unreadable).toBe(1);
		expect(report.summary).toMatch(/2 attributable to edit FORMAT/u);
	});

	it("says plainly that no failures proves nothing about format skill", () => {
		expect(summarizeEditFailures([]).summary).toMatch(/says nothing about a model's edit-format skill/u);
	});

	it("surfaces UNCLASSIFIED loudly instead of hiding it in the totals", () => {
		const report = summarizeEditFailures(["Blocked edit_file: brand new guard nobody mapped"]);
		expect(report.byKind.unknown).toBe(1);
		expect(report.summary).toMatch(/UNCLASSIFIED/u);
	});
});

/**
 * THE RATCHET — the reason classifying our own message text is safe rather than brittle.
 *
 * These strings come from ONE file behind a stable prefix, so the only real risk is DRIFT: a guard added later
 * would silently land in `unknown` (or worse, match a pattern loosely and be counted as a format failure). This
 * reads the tool's source and fails if any refusal site cannot be classified.
 */
describe("every refusal site in the edit tool is classifiable", () => {
	const source = readFileSync(EDIT_TOOL_PATH, "utf8");

	it("finds the block sites at all — a zero match would make this test vacuous", () => {
		// The guard's own guard: if the prefix is ever renamed, this test must fail rather than pass over 0 sites.
		expect(source.split("Blocked edit_file:").length - 1).toBeGreaterThanOrEqual(7);
	});

	it("classifies every LITERAL refusal message to a known kind", () => {
		const literals = blockSiteTexts(source).filter((text) => /[a-z]/iu.test(text));
		expect(literals.length).toBeGreaterThanOrEqual(5);
		for (const literal of literals) {
			expect(classifyEditFailure(literal), literal).not.toBe("unknown");
		}
	});

	it("accounts for the DELEGATED sites explicitly rather than quietly skipping them", () => {
		// Two sites are `Blocked edit_file: ${helper.message}` and carry no literal text of their own, so the
		// literal ratchet above cannot see them; they are covered by the path_guard unit cases, which use
		// `confineToolPath`'s actual strings. Pinning the COUNT is what keeps that exemption honest: a third
		// delegated site would fail here and force a decision, instead of silently escaping both checks.
		const delegated = blockSiteTexts(source).filter((text) => !/[a-z]/iu.test(text));
		expect(delegated).toHaveLength(2);
	});

	it("maps exactly ONE site to the format signal, so the metric cannot silently widen", () => {
		const formatSites = blockSiteTexts(source)
			.filter((text) => /[a-z]/iu.test(text))
			.filter((text) => isEditFormatSkillFailure(classifyEditFailure(text)));
		expect(formatSites).toHaveLength(1);
		expect(formatSites[0]).toMatch(/edit block/u);
	});
});

/**
 * The FORMAT cut wired into the existing metric — over data the ledger ALREADY carries.
 *
 * `resultSummary` is populated for every tool result including errors, so no new instrumentation was needed.
 * Verified against the live ledger, which contains `Blocked edit_file: edit block 2 did not match src/index.ts`.
 * The item's own history warns that "a false gap is as corrosive as a false claim" — this was one.
 */
describe("computeEditReliability — the format cut", () => {
	it("counts a context mismatch as a FORMAT failure and a guard block as not", async () => {
		const { computeEditReliability } = await import("../../../src/core/edit-reliability");
		const report = computeEditReliability({
			minCalls: 1,
			attempts: [
				{
					modelId: "lmstudio:qwen:coder:v1:http://x",
					toolCalls: [
						{
							name: "edit_file",
							outcome: "error",
							resultSummary: "Blocked edit_file: edit block 2 did not match a.ts",
						},
						{
							name: "edit_file",
							outcome: "error",
							resultSummary: "Blocked edit_file: potential token detected in b.ts",
						},
						{ name: "edit_file", outcome: "success", resultSummary: "ok" },
					],
				},
			],
		});
		const row = report.ranked[0];
		expect(row?.errors).toBe(2);
		expect(row?.formatFailures, "only the context mismatch is a format failure").toBe(1);
	});

	it("does not invent format failures from a legacy line with no resultSummary", async () => {
		// Absent on legacy lines. An unclassifiable error must not be counted as a format failure — that would
		// inflate exactly the number the cut exists to measure, and older ledgers are the common case.
		const { computeEditReliability } = await import("../../../src/core/edit-reliability");
		const report = computeEditReliability({
			minCalls: 1,
			attempts: [
				{
					modelId: "lmstudio:qwen:coder:v1:http://x",
					toolCalls: [{ name: "edit_file", outcome: "error" }],
				},
			],
		});
		expect(report.ranked[0]?.errors).toBe(1);
		expect(report.ranked[0]?.formatFailures).toBe(0);
	});
});
