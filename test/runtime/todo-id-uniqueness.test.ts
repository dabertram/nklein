import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `todo.md` item ids must be unique.
 *
 * Found the hard way on 2026-07-20: an item was created with the id `N12`, which already existed. Nothing
 * objected — not a lint, not a test, not review — until `scripts/todo-annotate.mjs` refused to annotate an
 * ambiguous id and surfaced it. `N13` turned out to be taken as well.
 *
 * A duplicate id is worse than untidy. Every later reference becomes ambiguous — including the ones a future
 * reader follows to find out what was decided and why — and this file is the project's single source of truth,
 * so an ambiguous reference in it costs more than one in code. The whole `b`-item convention (`F3.8` → `F3.8a`)
 * depends on ids being addressable.
 *
 * A full audit at the time found ZERO other duplicates across 451 ids, so this is a ratchet rather than a
 * discovery: it costs nothing today and refuses the mistake the next time someone reaches for a number without
 * checking. That is the same shape as the pass@k guard — the cheap check that only pays off on the day it fires.
 */
describe("todo.md item ids", () => {
	it("are unique", () => {
		const lines = readFileSync("todo.md", "utf8").split("\n");
		const seen = new Map<string, number[]>();
		lines.forEach((line, index) => {
			const match = /^- \[[ x~?>]\] \*\*([A-Za-z0-9.]+)(?=[ —.])/.exec(line);
			if (match?.[1]) {
				seen.set(match[1], [...(seen.get(match[1]) ?? []), index + 1]);
			}
		});
		const duplicates = [...seen.entries()]
			.filter(([, locations]) => locations.length > 1)
			.map(([id, locations]) => `${id} at lines ${locations.join(", ")}`);
		expect(duplicates, "duplicate todo.md ids make every later reference to them ambiguous").toEqual([]);
	});

	it("is scanning a non-trivial number of items — a regex that matches nothing would pass vacuously", () => {
		// The failure this guards: a formatting change to the item prefix would make the pattern match zero lines,
		// and "no duplicates among zero ids" is trivially true. The uniqueness assertion above would then pass
		// forever while checking nothing.
		const lines = readFileSync("todo.md", "utf8").split("\n");
		const ids = lines.filter((line) => /^- \[[ x~?>]\] \*\*([A-Za-z0-9.]+)(?=[ —.])/.test(line));
		expect(ids.length).toBeGreaterThan(300);
	});
});
