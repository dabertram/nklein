import { describe, expect, it } from "vitest";
import { auditEnvGatedDelivery, findEnvGuardFlags, NON_MECHANISM_FLAGS } from "../../../src/core/env-gated-delivery";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test (2026-08-08).
 *
 * It looks for the F4.8 shape: a deliverable whose EVERY consumer sits behind a default-OFF flag, so the import
 * chain is complete while nothing runs by default. Its own summary is careful to say a clean result means
 * "nothing was found", not "every path runs" — and that honesty is itself worth pinning, because the tempting
 * regression is to let a quiet audit read as a clean bill of health.
 *
 * The first test below is the sharpest: the module's own comment claims it avoids the shared-`/g`-regex trap
 * (a `lastIndex` carried between calls makes a scanner skip every second invocation). That claim was UNTESTED —
 * and the identical bug was found live in a spec's suggested implementation earlier the same day.
 */
const gated = (flag: string) => `if (isTruthyEnv(process.env.${flag})) { doTheThing(); }`;

describe("findEnvGuardFlags", () => {
	it("is STATELESS across calls — the shared-/g-regex trap the module claims to avoid", () => {
		// A module-level /g regex carries lastIndex between calls, so the SECOND call on identical input returns
		// nothing and the audit silently under-reports. Ten repeats, because the failure is 2-periodic and a
		// two-call check could still get lucky.
		const text = gated("NKLEIN_TOOL_GATE_OBSERVE");
		for (let attempt = 0; attempt < 10; attempt += 1) {
			expect(findEnvGuardFlags(text), `call ${attempt + 1} returned a different result`).toEqual([
				"NKLEIN_TOOL_GATE_OBSERVE",
			]);
		}
	});

	it("finds every distinct flag in one file, de-duplicated and sorted", () => {
		const text = `${gated("NKLEIN_B")}\n${gated("NKLEIN_A")}\n${gated("NKLEIN_B")}`;
		expect(findEnvGuardFlags(text)).toEqual(["NKLEIN_A", "NKLEIN_B"]);
	});

	it("matches only the project's idiom — a flag read another way is invisible, as documented", () => {
		// Not a defect to fix here: the module states this limit outright, and the audit's summary depends on it
		// being true. Pinning it stops someone widening the pattern without revisiting the summary's wording.
		expect(findEnvGuardFlags("process.env.NKLEIN_X === '1'")).toEqual([]);
		expect(findEnvGuardFlags("const x = process.env.NKLEIN_X;")).toEqual([]);
		expect(findEnvGuardFlags("")).toEqual([]);
	});

	it("tolerates whitespace inside the call", () => {
		expect(findEnvGuardFlags("isTruthyEnv( process.env.NKLEIN_X )")).toEqual(["NKLEIN_X"]);
	});
});

describe("auditEnvGatedDelivery", () => {
	const consumer = (text: string) => ({ path: "src/x.ts", text });

	it("flags the F4.8 shape: EVERY consumer gated", () => {
		const audit = auditEnvGatedDelivery([
			{
				element: "doThing",
				module: "src/core/thing.ts",
				consumers: [consumer(gated("NKLEIN_X")), consumer(gated("NKLEIN_X"))],
			},
		]);
		expect(audit.suspicions[0]?.exposure).toBe("all");
		expect(audit.fullyGated).toEqual(["doThing (src/core/thing.ts)"]);
	});

	it("does NOT flag a deliverable with even one ungated consumer", () => {
		// The distinction the whole check turns on: one live path means the element is reachable by default, so
		// reporting it would be a false alarm that costs a reader's trust.
		const audit = auditEnvGatedDelivery([
			{
				element: "doThing",
				module: "src/core/thing.ts",
				consumers: [consumer(gated("NKLEIN_X")), consumer("doThing();")],
			},
		]);
		expect(audit.suspicions[0]?.exposure).toBe("some");
		expect(audit.fullyGated).toEqual([]);
	});

	it("separates an UNWIRED core from an env-gating question", () => {
		// Zero consumers is a different finding with a different fix, and collapsing the two would send someone
		// hunting for a flag that does not exist.
		const audit = auditEnvGatedDelivery([{ element: "orphan", module: "src/core/orphan.ts", consumers: [] }]);
		expect(audit.suspicions[0]?.exposure).toBe("no_consumers");
		expect(audit.suspicions[0]?.note).toMatch(/unwired core/i);
		expect(audit.fullyGated).toEqual([]);
	});

	it("reports flags absent from the registry, and stays quiet about registered ones", () => {
		const deliverables = [
			{ element: "a", module: "m", consumers: [consumer(gated("NKLEIN_KNOWN"))] },
			{ element: "b", module: "m", consumers: [consumer(gated("NKLEIN_STRANGER"))] },
		];
		expect(auditEnvGatedDelivery(deliverables, ["NKLEIN_KNOWN"]).unregisteredFlags).toEqual(["NKLEIN_STRANGER"]);
		expect(auditEnvGatedDelivery(deliverables, ["NKLEIN_KNOWN", "NKLEIN_STRANGER"]).unregisteredFlags).toEqual([]);
	});

	it("treats an EMPTY registry as 'nothing registered', not 'everything registered'", () => {
		// The default argument is `[]`, and the dangerous reading of an empty registry is silence. Every flag
		// found must surface when nothing is known.
		const audit = auditEnvGatedDelivery([{ element: "a", module: "m", consumers: [consumer(gated("NKLEIN_X"))] }]);
		expect(audit.unregisteredFlags).toEqual(["NKLEIN_X"]);
	});

	it("says a CLEAN result means nothing was FOUND — never that every path runs", () => {
		// The module's own honesty property. A summary that reads as a clean bill of health is precisely the
		// green-signal substitution this checker exists to avoid producing.
		const audit = auditEnvGatedDelivery([{ element: "a", module: "m", consumers: [consumer("a();")] }]);
		expect(audit.fullyGated).toEqual([]);
		expect(audit.summary).toMatch(/NOTHING WAS FOUND/i);
		expect(audit.summary).toMatch(/cannot prove/i);
	});

	it("calls a positive result a SUSPICION, not a verdict", () => {
		const audit = auditEnvGatedDelivery([{ element: "a", module: "m", consumers: [consumer(gated("NKLEIN_X"))] }]);
		expect(audit.summary).toMatch(/suspicion, never a verdict/i);
		expect(audit.suspicions[0]?.note).toMatch(/VERIFY BY READING/i);
	});

	it("handles an empty deliverable list without inventing a finding", () => {
		const audit = auditEnvGatedDelivery([]);
		expect(audit.suspicions).toEqual([]);
		expect(audit.fullyGated).toEqual([]);
		expect(audit.unregisteredFlags).toEqual([]);
	});
});

describe("NON_MECHANISM_FLAGS", () => {
	it("gives every exemption a written REASON, not a bare listing", () => {
		// An exemption list without reasons decays into a place to hide inconvenient flags. Each entry must say
		// why the flag is not a mechanism — dev instrument, eval harness, or artifact-observable.
		const entries = Object.entries(NON_MECHANISM_FLAGS);
		expect(entries.length).toBeGreaterThan(0);
		for (const [flag, reason] of entries) {
			expect(reason.length, `${flag} has no stated reason`).toBeGreaterThan(20);
		}
	});
});
