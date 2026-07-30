import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MECHANISM_REGISTRY } from "../../src/core/mechanism-observation-audit";
import { NIGHTLY_PACK_REGISTRY } from "../../src/core/nightly-pack-registry";
import { OBSERVABLE_DRAIN_SIGNALS } from "../../src/core/nightly-signal-extraction";

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

	it("only asserts signals that are OBSERVABLE and declared every_run — the promotion rule, enforced", () => {
		// This started life as `expect(mustFire).toEqual([])` while the lane was unvalidated, and it correctly
		// failed the moment 19 signals were promoted from the first GREEN drain (2026-07-30). Rather than relaxing
		// it, it now pins the RULE that made the promotion legitimate, so the next promotion has to earn it too:
		//   (a) the collector must actually watch the signal — otherwise the pack reports `indeterminate` forever
		//       while looking strict, which is the failure the pack registry's header is about;
		//   (b) the mechanism must declare `expectation: "every_run"` — a condition-triggered (`exceptional`)
		//       mechanism would fail the cell on every run where its condition simply did not arise.
		const pack = NIGHTLY_PACK_REGISTRY.get("flags-on-coverage");
		expect(pack, "flags-on-coverage pack is not registered").toBeDefined();
		const observable = new Set(OBSERVABLE_DRAIN_SIGNALS);
		const everyRun = new Set(
			MECHANISM_REGISTRY.filter((entry) => entry.expectation === "every_run").map((entry) => entry.category),
		);
		const unobservable = (pack?.mustFire ?? []).filter((signal) => !observable.has(signal));
		expect(unobservable, `mustFire names signals the collector never watches: ${unobservable.join(", ")}`).toEqual(
			[],
		);
		const notEveryRun = (pack?.mustFire ?? []).filter((signal) => !everyRun.has(signal));
		expect(
			notEveryRun,
			`mustFire names condition-triggered mechanisms, which will fail whenever the condition does not arise: ${notEveryRun.join(", ")}`,
		).toEqual([]);
	});
});
