/**
 * Structural guard over EVERY checked-in scenario set (scenarios/<project>/{perfect,flaky}-run.json): each set must
 * parse, compile through the real track compiler, and honor the wire truths from the fast-path bring-up (2026-07-10)
 * — decompose keyed on a seed-only needle as class "any", per-card tracks with unique needles, review ladders that
 * end in a text turn, repeatLastTurn everywhere, and an any-class fallback. If the compiler or !Klein's shells
 * evolve, this is the test that tells us which of the 20 sets rotted.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileScenarioScript } from "../src/index.js";
import type { ScenarioScript } from "../src/index.js";

const SCENARIOS_DIR = join(__dirname, "..", "scenarios");
const setDirs = readdirSync(SCENARIOS_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

describe("checked-in scenario sets", () => {
	it("cover the lower-20 dev-test projects", () => {
		expect(setDirs.length).toBeGreaterThanOrEqual(20);
	});

	for (const dir of setDirs) {
		for (const runFile of ["perfect-run.json", "flaky-run.json"]) {
			it(`${dir}/${runFile} compiles and honors the wire truths`, () => {
				const script = JSON.parse(readFileSync(join(SCENARIOS_DIR, dir, runFile), "utf8")) as ScenarioScript;
				expect(script.name.length).toBeGreaterThan(0);
				expect(typeof script.seed).toBe("number");

				const fixtures = compileScenarioScript(script);
				expect(fixtures.length).toBeGreaterThanOrEqual(script.tracks.length);

				// No track may use the unmatchable class "decompose" without a needle — and since plan seeds are
				// wire-identical to worker cards, decompose responses must ride an "any"-class track WITH a needle.
				const decomposeEmitters = script.tracks.filter((track) =>
					track.turns.some(
						(turn) => turn.behavior.kind === "tool_calls" && turn.behavior.calls.some((call) => call.name === "decompose_project"),
					),
				);
				expect(decomposeEmitters.length).toBeGreaterThan(0);
				for (const track of decomposeEmitters) {
					expect(track.requestClass).toBe("any");
					expect(track.userMessageIncludes ?? "").not.toHaveLength(0);
				}

				// Per-card needles must be unique within a class or sequence ladders bleed across cards.
				for (const cls of ["worker", "review"] as const) {
					const needles = script.tracks.filter((track) => track.requestClass === cls).map((track) => track.userMessageIncludes ?? "");
					expect(new Set(needles).size).toBe(needles.length);
				}

				// Review ladders end with a text turn (the runner re-prompts until a non-tool turn) and repeat.
				for (const track of script.tracks.filter((track) => track.requestClass === "review")) {
					const last = track.turns[track.turns.length - 1];
					expect(last?.behavior.kind).toBe("text");
					expect(track.repeatLastTurn).toBe(true);
				}

				// Every set carries an any-class fallback so nothing strict-misses.
				expect(
					script.tracks.some((track) => track.requestClass === "any" && !track.userMessageIncludes && track.repeatLastTurn),
				).toBe(true);

				// submit_review calls always carry a non-empty summary (feedback-only verdicts bounce).
				for (const track of script.tracks) {
					for (const turn of track.turns) {
						if (turn.behavior.kind !== "tool_calls") continue;
						for (const call of turn.behavior.calls) {
							if (call.name !== "submit_review") continue;
							expect(String((call.arguments as { summary?: unknown }).summary ?? "")).not.toHaveLength(0);
						}
					}
				}
			});
		}
	}
});
