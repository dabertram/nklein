import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A flag read with `isEnabledByDefaultEnv` must never be DESCRIBED as opt-in.
 *
 * ── THE DEFECT THIS CAUGHT, AND WHY IT MATTERS MORE THAN A TYPO ──
 * `NKLEIN_DURABLE_SCHEDULER` was promoted to default-ON in `cda009684` ("live restart-mid-run validation
 * complete"). Its own header went on saying *"default OFF = byte-identical"* for months, and `runtime-server.ts`
 * said the tick timer was *"only armed when NKLEIN_DURABLE_SCHEDULER is set"*.
 *
 * **"Default OFF = byte-identical" is the exact phrase a reviewer relies on to conclude a change cannot affect a
 * normal run.** On the durable scheduler — the component that decides which cards get dispatched — it was
 * backwards. It misled the author of this very test while they were reasoning about the blast radius of a change
 * to that subsystem, minutes before this file existed.
 *
 * ── WHY ONLY THIS DIRECTION ──
 * The mirror check (a flag read with `isTruthyEnv` described as default-ON) is deliberately NOT implemented. The
 * codebase has a legitimate pattern that looks identical to the error: a default-ON CONFIG BIT whose env var is an
 * override, e.g. *"`sandboxMcpServersEnabled` (ON by default; global/per-project opt-out) OR the `NKLEIN_SANDBOX_MCP`
 * env override"* — accurate, and indistinguishable from a mistake by any line-level rule. A check that flags
 * correct code gets an allow-list bolted on until it means nothing.
 *
 * ── CLEAN WHEN WRITTEN ──
 * Audited 2026-07-31: seven flags are default-ON; only the durable scheduler was mis-described, and it is fixed.
 * A ratchet, not a cleanup.
 */

/** Phrases that tell a reader "this is off unless you turn it on". */
const OPT_IN_CLAIMS = [/default\s+off/iu, /\bopt-in\b/iu, /only armed when/iu, /\bwhen set\b/iu, /\bif set\b/iu];

function defaultOnFlagNames(sources: readonly { file: string; text: string }[]): string[] {
	const names = new Set<string>();
	for (const { text } of sources) {
		for (const match of text.matchAll(/isEnabledByDefaultEnv\(\s*process\.env\.([A-Z][A-Z0-9_]*)/gu)) {
			names.add(match[1] as string);
		}
	}
	return [...names].sort();
}

describe("default-ON flags are documented as default-ON", () => {
	const sources = globSync("src/**/*.{ts,tsx}").map((file) => ({ file, text: readFileSync(file, "utf8") }));

	it("finds the default-ON flags at all", () => {
		// Without this, a broken extractor yields an empty list and the assertion below passes by vacuity — the
		// same confident-green failure the durable-scheduler comment itself was.
		const names = defaultOnFlagNames(sources);
		expect(names.length).toBeGreaterThanOrEqual(5);
		expect(names).toContain("NKLEIN_DURABLE_SCHEDULER");
	});

	it("never describes one as opt-in or default-OFF", () => {
		const names = defaultOnFlagNames(sources);
		const offenders: string[] = [];
		for (const { file, text } of sources) {
			for (const [index, line] of text.split("\n").entries()) {
				// Same line only: a file may legitimately discuss a default-ON flag and, elsewhere, an opt-in one.
				const named = names.filter((name) => line.includes(name));
				if (named.length === 0 || !OPT_IN_CLAIMS.some((claim) => claim.test(line))) {
					continue;
				}
				offenders.push(`${file}:${index + 1} — ${named.join(",")} — ${line.trim().slice(0, 120)}`);
			}
		}
		expect(
			offenders,
			`these lines describe a DEFAULT-ON flag as opt-in. "default OFF = byte-identical" is what a reviewer relies on to conclude a change cannot affect a normal run:\n  ${offenders.join("\n  ")}`,
		).toEqual([]);
	});
});
