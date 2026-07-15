import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CurrencyEvidence } from "../../../src/core/evidence-currency-status";
import { appendCurrencyEvidence, readAllCurrencyEvidence } from "../../../src/state/currency-evidence-store";

function evidence(overrides: Partial<CurrencyEvidence>): CurrencyEvidence {
	return {
		id: "https://example.gov/doc",
		sourceDateMs: Date.parse("2024-01-01"),
		trust: "high",
		supports: true,
		conflictsWithIds: [],
		...overrides,
	};
}

describe("currency-evidence-store", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "currency-evidence-store-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns [] when the log does not exist yet", async () => {
		expect(await readAllCurrencyEvidence({ rootDir: root })).toEqual([]);
	});

	it("round-trips currency evidence (including a null date + declared conflicts) through the validated log", async () => {
		await appendCurrencyEvidence(
			[evidence({ id: "a" }), evidence({ id: "b", sourceDateMs: null, trust: "unknown", conflictsWithIds: ["a"] })],
			{ rootDir: root },
		);
		const back = await readAllCurrencyEvidence({ rootDir: root });
		expect(back).toHaveLength(2);
		expect(back[1]?.sourceDateMs).toBeNull();
		expect(back[1]?.conflictsWithIds).toEqual(["a"]);
	});
});
