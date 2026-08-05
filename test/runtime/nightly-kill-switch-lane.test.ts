import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEnabledByDefaultEnv } from "../../src/core/env-flag";
import { defaultOnKillSwitches, FEATURE_FLAG_REGISTRY } from "../../src/core/feature-flag-registry";

/**
 * N11 lane (c) — the kill-switches-OFF lane: the perfect recording drained with every DEFAULT-ON mechanism
 * disabled. The lane's promise is the same one every default flip makes ("opt-out: NKLEIN_X=0 restores the
 * prior behavior"), so its composition must track the registry AUTOMATICALLY (a newly shipped default-ON flag
 * joins the lane by construction, not by someone remembering), and the single disable value the lane uses must
 * be one every registered kill-switch gate honors.
 */
const commandSource = readFileSync(join(__dirname, "../../src/commands/dev-nightly-command.ts"), "utf8");

describe("N11 kill_switches_off lane", () => {
	it("is a registered profile replaying the perfect recording", () => {
		expect(commandSource).toMatch(/kill_switches_off:\s*"perfect"/);
	});

	it("builds its env FROM the registry (a new default-ON flag cannot drift past the lane)", () => {
		expect(commandSource).toMatch(
			/kill_switches_off:\s*Object\.fromEntries\(defaultOnKillSwitches\(\)\.map\(\(flag\) => \[flag, "off"\]\)\)/,
		);
	});

	it('"off" actually disables every default-ON gate style the registry contains', () => {
		// The lane uses ONE disable value for every flag, so every gate must honor it. Gates without a declared
		// custom matcher follow the section convention (isEnabledByDefaultEnv — "off" disables). A gate that
		// DECLARES a matcher (the parenthesized part of its registry note) must name "off" in it: today that is
		// /^(0|false|off)$/i twice and `!== "off"` once. A new default-ON flag whose gate cannot honor "off"
		// would be silently ENABLED in the very lane that claims to disable it — this test makes that loud.
		expect(isEnabledByDefaultEnv("off")).toBe(false);
		for (const spec of FEATURE_FLAG_REGISTRY.filter((candidate) => candidate.defaultOn === true)) {
			const declaredMatcher = /\(([^)]*[!=<>~^][^)]*)\)/.exec(spec.gate)?.[1];
			if (declaredMatcher !== undefined) {
				expect(
					declaredMatcher.toLowerCase().includes("off"),
					`${spec.flag}'s declared gate matcher (${spec.gate}) does not honor "off" — the kill_switches_off lane would silently skip it`,
				).toBe(true);
			}
		}
	});

	it("the registry names the core kill-switches this lane exists to exercise", () => {
		const flags = defaultOnKillSwitches();
		expect(flags.length).toBeGreaterThanOrEqual(8);
		for (const expected of [
			"NKLEIN_DURABLE_SCHEDULER",
			"NKLEIN_REPO_VERIFY",
			"NKLEIN_FITNESS_ROUTING",
			"NKLEIN_MODEL_SENSITIVE_PRUNE",
			"NKLEIN_MODEL_FAILOVER",
		]) {
			expect(flags, `expected default-ON kill-switch ${expected} in the registry`).toContain(expected);
		}
	});

	it("the manifest drains the lane (project 02, alongside flags_on)", () => {
		const manifest = JSON.parse(readFileSync(join(__dirname, "../../nightly-manifest.json"), "utf8")) as {
			projects?: { id?: string; modelProfiles?: string[] }[];
		};
		const projects = Array.isArray(manifest) ? manifest : (manifest.projects ?? []);
		const project02 = projects.find((project) => project.id === "02");
		expect(project02?.modelProfiles).toContain("kill_switches_off");
		expect(project02?.modelProfiles).toContain("flags_on");
	});
});
