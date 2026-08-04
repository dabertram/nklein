import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_REGISTRY, FLAGS_ON_LANE_EXCLUSIONS } from "../../src/core/feature-flag-registry";
import { LEDGER_OBSERVABLE_LANE_FLAGS, MECHANISM_REGISTRY } from "../../src/core/mechanism-observation-audit";
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
	it("enables every flag the mechanism registry names as a gate, unless PERMANENTLY excluded with a reason", () => {
		// The two registries COMPOSE rather than conflict: FLAGS_ON_LANE_EXCLUSIONS `permanent` entries are flags
		// this replay lane structurally cannot run (first case: NKLEIN_TOOL_GATE_ENFORCE narrows the tools array,
		// which changes every affected replayed request). A `pending_validation` exclusion still FAILS here — that
		// kind claims the flag belongs in the lane, so the registry naming it as a gate makes the gap real.
		const permanentlyExcluded = new Set(
			FLAGS_ON_LANE_EXCLUSIONS.filter((entry) => entry.kind === "permanent").map((entry) => entry.flag),
		);
		const registryFlags = new Set(
			[
				...MECHANISM_REGISTRY.map((entry) => entry.enabledBy),
				...MECHANISM_REGISTRY.flatMap((entry) => entry.covers ?? []),
				...LEDGER_OBSERVABLE_LANE_FLAGS,
			].filter(
				(flag): flag is string =>
					// The lane's universe is DEFAULT-OFF opt-ins: a covers-linked flag that is default-ON (or
					// dev-only) is observable, but it is not lane material and must not enter the demand set.
					Boolean(flag) &&
					FEATURE_FLAG_REGISTRY.some((spec) => spec.flag === flag && !spec.defaultOn && spec.mode !== "dev_only"),
			),
		);
		const missing = [...registryFlags]
			.filter((flag) => !readFlagsOnEnv().has(flag) && !permanentlyExcluded.has(flag))
			.sort();
		expect(
			missing,
			`flags_on does not enable: ${missing.join(", ")} — a newly registered mechanism would go uncovered while the lane still claims to cover it`,
		).toEqual([]);
	});

	it("enables no flag the registry does not know about (the list stays traceable, not aspirational)", () => {
		const registryFlags = new Set(
			[
				...MECHANISM_REGISTRY.map((entry) => entry.enabledBy),
				...MECHANISM_REGISTRY.flatMap((entry) => entry.covers ?? []),
				...LEDGER_OBSERVABLE_LANE_FLAGS,
			].filter((flag): flag is string => Boolean(flag)),
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

/**
 * The lane's BROADER claim — "replayed with EVERY default-OFF opt-in".
 *
 * The test above only requires flags the MECHANISM registry names as a gate, which is a subset. Checked against
 * the flag registry on 2026-08-01 the lane enabled **32 of 46**, so the broader claim had gone unchecked since it
 * was written. Every gap is now declared with a reason and a kind, and this keeps that declaration complete: a new
 * opt-in flag must either join the lane or say why it does not.
 */
describe("N11 flags_on lane — every default-OFF opt-in is enabled or declared", () => {
	const laneCandidates = () => FEATURE_FLAG_REGISTRY.filter((spec) => !spec.defaultOn && spec.mode !== "dev_only");

	it("has candidates to check", () => {
		// A broken filter yields an empty list and everything below passes by vacuity.
		expect(laneCandidates().length).toBeGreaterThan(30);
	});

	it("ENABLES or DECLARES every default-OFF opt-in", () => {
		const lane = readFlagsOnEnv();
		const declared = new Set(FLAGS_ON_LANE_EXCLUSIONS.map((entry) => entry.flag));
		const undeclared = laneCandidates()
			.map((spec) => spec.flag)
			.filter((flag) => !lane.has(flag) && !declared.has(flag))
			.sort();
		expect(
			undeclared,
			`these default-OFF opt-ins are neither enabled by the lane nor declared as exclusions, so the lane's "EVERY default-OFF opt-in" claim is false for them:\n  ${undeclared.join("\n  ")}`,
		).toEqual([]);
	});

	it("keeps the exclusion list HONEST — nothing excluded is also enabled", () => {
		// An entry that stays after the flag joins the lane reads as a standing reason not to enable something
		// that IS enabled, which is worse than no note at all.
		const lane = readFlagsOnEnv();
		for (const entry of FLAGS_ON_LANE_EXCLUSIONS) {
			expect(lane.has(entry.flag), `${entry.flag} is both enabled by the lane and listed as excluded`).toBe(false);
		}
	});

	it("gives every exclusion a reason, and every pending one is a real opt-in", () => {
		const candidates = new Set(laneCandidates().map((spec) => spec.flag));
		for (const entry of FLAGS_ON_LANE_EXCLUSIONS) {
			expect(entry.reason.length, `${entry.flag} is excluded without a reason`).toBeGreaterThan(20);
			expect(candidates.has(entry.flag), `${entry.flag} is excluded but is not a default-OFF opt-in`).toBe(true);
		}
	});
});
