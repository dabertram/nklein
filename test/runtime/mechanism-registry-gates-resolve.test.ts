import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MECHANISM_REGISTRY } from "../../src/core/mechanism-observation-audit";

/**
 * P15.1c ratchet — every mechanism's ENABLING FLAG is actually read by something.
 *
 * ── THE FAILURE THIS CATCHES ──
 * `dev mechanism-registry` classifies a mechanism with zero observations as `never_enabled`, and says so
 * reassuringly: *"zero is the CORRECT result, not a smell"*. That sentence is only true while the named flag can
 * still turn the mechanism on. **Rename or delete the flag and the registry keeps reporting the same reassurance
 * forever for a mechanism nobody can enable** — the mechanism is silently unreachable, and the one tool built to
 * notice silence is the tool asserting the silence is fine.
 *
 * It is the same shape as `too_new_to_judge` pinning a mechanism at "not yet judgeable" permanently, and the same
 * shape as a reachability walk that passes because its closure quietly shrank: **a check whose failure mode is a
 * confident green.**
 *
 * ── WHY NOW, AND WHY A RATCHET ──
 * Audited 2026-07-31: all 45 registry entries resolve, 0 unread. The check was written when it was already clean,
 * which makes it a ratchet that keeps a clean registry honest rather than a cleanup task — the cheapest moment to
 * add one, and the only moment at which it costs nothing.
 *
 * ── THE CIRCULARITY THIS TEST HAD TO AVOID ──
 * The first version of this audit grepped `src/` for each flag and found all 45 — but every flag is a string
 * literal in the registry's own declaration, so it was matching itself. **`mechanism-observation-audit.ts` is
 * excluded by name below, and that exclusion is the entire substance of the test.** Without it this file would
 * pass unconditionally while proving nothing, which is exactly the defect class it exists to prevent.
 */

/** The file that DECLARES the registry. Its own string literals must not count as a mechanism being wired. */
const DECLARING_FILE = "src/core/mechanism-observation-audit.ts";

describe("mechanism registry enabling flags", () => {
	const sources = globSync("src/**/*.{ts,tsx}")
		.filter((file) => file !== DECLARING_FILE)
		.map((file) => readFileSync(file, "utf8"));

	it("excludes the declaring file, or this test proves nothing", () => {
		// Guarding the guard: if the path drifts, every flag matches its own declaration and the suite goes green
		// while the registry rots. Assert both that the file exists and that it is out of the corpus.
		expect(globSync(DECLARING_FILE)).toEqual([DECLARING_FILE]);
		expect(sources.length).toBeGreaterThan(100);
		expect(readFileSync(DECLARING_FILE, "utf8")).toContain("MECHANISM_REGISTRY");
	});

	it("has entries to check at all", () => {
		// An empty registry would satisfy every per-flag assertion below by vacuity.
		expect(MECHANISM_REGISTRY.length).toBeGreaterThan(20);
	});

	it("every gated mechanism's flag is READ somewhere outside the registry declaration", () => {
		const gated = MECHANISM_REGISTRY.filter(
			(entry): entry is typeof entry & { enabledBy: string } =>
				typeof entry.enabledBy === "string" && entry.enabledBy.length > 0,
		);
		// `enabledBy: null` means always-on and is legitimately not a flag; there must still be gated ones left.
		expect(gated.length).toBeGreaterThan(20);

		const unread = gated
			.filter((entry) => !sources.some((source) => source.includes(entry.enabledBy)))
			.map((entry) => `${entry.enabledBy} (${entry.category})`);

		expect(
			unread,
			`these mechanisms name a flag nothing reads, so they can never be enabled — and the registry would keep reporting "never_enabled: zero is the CORRECT result" about them forever:\n  ${unread.join("\n  ")}`,
		).toEqual([]);
	});

	it("names flags in the project's NKLEIN_ convention, so a typo is visible", () => {
		const offConvention = MECHANISM_REGISTRY.filter(
			(entry) => typeof entry.enabledBy === "string" && !entry.enabledBy.startsWith("NKLEIN_"),
		).map((entry) => `${entry.category}: ${entry.enabledBy}`);
		expect(offConvention).toEqual([]);
	});
});
