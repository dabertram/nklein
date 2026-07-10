import { describe, expect, it } from "vitest";
import { createSeededRng } from "../src/scenario/seeded-rng.js";

describe("createSeededRng", () => {
	it("same seed ⇒ identical sequence (the determinism contract)", () => {
		const a = createSeededRng(42);
		const b = createSeededRng(42);
		const seqA = Array.from({ length: 20 }, () => a.next());
		const seqB = Array.from({ length: 20 }, () => b.next());
		expect(seqA).toEqual(seqB);
	});

	it("different seeds diverge", () => {
		const a = createSeededRng(1);
		const b = createSeededRng(2);
		expect(Array.from({ length: 8 }, () => a.next())).not.toEqual(Array.from({ length: 8 }, () => b.next()));
	});

	it("int/chance/pick stay in bounds and are deterministic", () => {
		const rng = createSeededRng(7);
		for (let i = 0; i < 100; i++) {
			const n = rng.int(5);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThan(5);
		}
		expect(rng.chance(0)).toBe(false);
		expect(rng.chance(1)).toBe(true);
		expect(["a", "b", "c"]).toContain(rng.pick(["a", "b", "c"]));
		expect(() => rng.pick([])).toThrow();
	});

	it("child streams are independent and stable per label", () => {
		const first = createSeededRng(99).child("chaos").next();
		const second = createSeededRng(99).child("chaos").next();
		const other = createSeededRng(99).child("timing").next();
		expect(first).toBe(second);
		expect(first).not.toBe(other);
	});
});
