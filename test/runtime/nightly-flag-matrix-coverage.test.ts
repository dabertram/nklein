import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MECHANISM_REGISTRY } from "../../src/core/mechanism-observation-audit";
import { NIGHTLY_PACK_REGISTRY } from "../../src/core/nightly-pack-registry";

/**
 * N11 flag-matrix lane — the guard that keeps it HONEST.
 *
 * The `flags_on` profile exists for one reason: 29 of the 43 registered mechanisms are gated behind default-OFF
 * flags, and a measurement across three real campaign runs (2026-07-29) found none of them firing — correctly, since
 * a default profile cannot reach them. The lane replays the baseline recording with every such flag enabled.
 *
 * That only stays true if the flag list keeps up with the registry. Without this test, registering a new flag-gated
 * mechanism silently leaves it uncovered while the lane's NAME still promises coverage — the exact "looks thorough,
 * checks nothing" failure the pack registry's header warns about.
 */

function readFlagsOnEnv(): Set<string> {
	// Read the runner's source rather than importing it: the module pulls in the whole nightly command surface
	// (child_process, fs, tRPC) for what is a static data assertion.
	const source = readFileSync("src/commands/dev-nightly-command.ts", "utf8");
	const block = /flags_on:\s*\{([\s\S]*?)\n\t\},/.exec(source);
	if (!block) {
		throw new Error("flags_on env block not found in dev-nightly-command.ts");
	}
	return new Set([...block[1].matchAll(/\b(NKLEIN_[A-Z0-9_]+)\s*:/g)].map((match) => match[1] as string));
}

describe("N11 flags_on lane covers every flag-gated mechanism", () => {
	it("enables every flag the mechanism registry names as a gate", () => {
		const registryFlags = new Set(
			MECHANISM_REGISTRY.map((entry) => entry.enabledBy).filter((flag): flag is string => Boolean(flag)),
		);
		const missing = [...registryFlags].filter((flag) => !readFlagsOnEnv().has(flag)).sort();
		expect(
			missing,
			`flags_on does not enable: ${missing.join(", ")} — a newly registered mechanism would go uncovered while the lane still claims to cover it`,
		).toEqual([]);
	});

	it("enables no flag the registry does not know about (the list stays traceable, not aspirational)", () => {
		const registryFlags = new Set(
			MECHANISM_REGISTRY.map((entry) => entry.enabledBy).filter((flag): flag is string => Boolean(flag)),
		);
		const unknown = [...readFlagsOnEnv()].filter((flag) => !registryFlags.has(flag)).sort();
		expect(unknown, `flags_on enables flags no registered mechanism claims: ${unknown.join(", ")}`).toEqual([]);
	});

	it("registers the lane's pack, and that pack asserts nothing it has not yet observed", () => {
		const pack = NIGHTLY_PACK_REGISTRY.get("flags-on-coverage");
		expect(pack, "flags-on-coverage pack is not registered").toBeDefined();
		// Deliberate: 18 mechanisms are promotion CANDIDATES, but until a real drain shows which of them emit under
		// this scenario, asserting them would manufacture `indeterminate` results that read as rigour. First run
		// measures; proven signals are promoted into mustFire afterwards.
		expect(pack?.mustFire).toEqual([]);
	});
});
