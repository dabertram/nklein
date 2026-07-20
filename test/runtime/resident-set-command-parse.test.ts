import { describe, expect, it } from "vitest";
import { type ResidencyCandidate, recommendResidentSet } from "../../src/core/resident-set-recommendation";

/**
 * F12.77 wire — the JSONL parsing `dev resident-set` does, and the property that keeps the command honest: the
 * recommendation is RANKED BY TIME SAVED (requests × load cost), NOT by fitness, so a heavily-used good-enough
 * model beats a rarely-used excellent one for a scarce slot.
 */

function parse(text: string): ResidencyCandidate[] {
	const out: ResidencyCandidate[] = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const p = JSON.parse(t) as Partial<ResidencyCandidate>;
			if (
				typeof p.modelId === "string" &&
				typeof p.sizeBytes === "number" &&
				typeof p.observationCount === "number" &&
				typeof p.requestCount === "number" &&
				(p.measuredFitness === null || typeof p.measuredFitness === "number")
			) {
				out.push({
					modelId: p.modelId,
					sizeBytes: p.sizeBytes,
					measuredFitness: p.measuredFitness ?? null,
					observationCount: p.observationCount,
					requestCount: p.requestCount,
				});
			}
		} catch {
			// skip
		}
	}
	return out;
}

const GB = 1024 ** 3;

describe("resident-set command", () => {
	it("parses candidate JSONL, tolerating null fitness and skipping malformed", () => {
		const parsed = parse(
			'{"modelId":"a","sizeBytes":100,"measuredFitness":null,"observationCount":1,"requestCount":2}\n{bad}',
		);
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.measuredFitness).toBeNull();
	});

	it("prefers the heavily-requested model over the excellent-but-rare one for one slot", () => {
		const rec = recommendResidentSet({
			candidates: [
				{ modelId: "used", sizeBytes: 9 * GB, measuredFitness: 0.8, observationCount: 40, requestCount: 120 },
				{ modelId: "rare", sizeBytes: 9 * GB, measuredFitness: 0.95, observationCount: 40, requestCount: 3 },
			],
			budgetBytes: 16 * GB, // usable ~12GB after reserve → one 9GB slot
		});
		expect(rec.recommended.map((m) => m.modelId)).toEqual(["used"]);
	});

	it("excludes an unmeasured model rather than letting it take a slot with no evidence", () => {
		const rec = recommendResidentSet({
			candidates: [
				{ modelId: "mystery", sizeBytes: 4 * GB, measuredFitness: null, observationCount: 2, requestCount: 50 },
			],
			budgetBytes: 32 * GB,
		});
		expect(rec.recommended).toHaveLength(0);
		expect(rec.excluded.some((m) => m.modelId === "mystery" && m.reason === "unmeasured")).toBe(true);
	});
});
