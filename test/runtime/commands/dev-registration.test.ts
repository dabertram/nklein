import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { registerDevCommand } from "../../../src/commands/dev";

/**
 * A registration ratchet over the whole `dev` subcommand surface (83+ commands and growing — ~13 added
 * 2026-07-20). None of these failure modes throws at registration; each just silently produces a broken CLI:
 *  - a DUPLICATE name means one command shadows another and the wrong action runs;
 *  - a MISSING description means the command is invisible in `--help`, so a real tool reads as not existing;
 *  - a command that failed to register at all is simply gone.
 * Commander exposes the assembled list after registration, so these are checkable without invoking anything.
 */

function devSubcommands() {
	const program = new Command();
	registerDevCommand(program);
	const dev = program.commands.find((command) => command.name() === "dev");
	if (!dev) {
		throw new Error("dev command did not register at all");
	}
	return dev.commands;
}

describe("dev command registration", () => {
	it("registers a substantial, non-empty command surface", () => {
		// A lower bound, not an exact count — the exact number churns as commands are added. The point is that
		// registration did not silently collapse to a handful.
		expect(devSubcommands().length).toBeGreaterThanOrEqual(50);
	});

	it("has NO duplicate command names — a duplicate silently shadows one action with another", () => {
		const names = devSubcommands().map((command) => command.name());
		const seen = new Map<string, number>();
		for (const name of names) {
			seen.set(name, (seen.get(name) ?? 0) + 1);
		}
		const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
		expect(duplicates, `duplicate dev command name(s): ${duplicates.join(", ")}`).toEqual([]);
	});

	it("every command carries a description — one without is invisible in --help", () => {
		const undocumented = devSubcommands()
			.filter((command) => command.description().trim().length === 0)
			.map((command) => command.name());
		expect(undocumented, `dev command(s) missing a description: ${undocumented.join(", ")}`).toEqual([]);
	});

	it("includes the observability + de-orphaning commands added this session", () => {
		// Names, not counts: these specific commands were wired 2026-07-20 and a regression that dropped one
		// should name it. If any is renamed, update it here deliberately rather than letting the surface shrink.
		const names = new Set(devSubcommands().map((command) => command.name()));
		for (const expected of [
			"tracking-coverage",
			"mechanism-registry",
			"env-gated",
			"interventions",
			"spec-review",
			"compaction-format",
			"cache-check",
			"ablation",
			"resident-set",
			"off-track",
			"synthesis-saving",
			"ledger-health",
			"served-context",
			"diagnose",
		]) {
			expect(names.has(expected), `missing dev command: ${expected}`).toBe(true);
		}
	});
});
