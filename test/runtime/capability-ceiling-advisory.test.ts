import { describe, expect, it } from "vitest";
import { assessCeilingAdvisory } from "../../src/core/capability-ceiling-advisory";

describe("capability-ceiling advisory (F12.105)", () => {
	it("advises honestly when difficulty materially exceeds best available capability", () => {
		const verdict = assessCeilingAdvisory({
			cardDifficulty: 0.9,
			role: "worker",
			bestAvailableCapability: 0.5,
			routedModelKey: "gemma-4-31b",
		});
		expect(verdict.exceedsFleet).toBe(true);
		expect(verdict.gap).toBeCloseTo(0.4);
		expect(verdict.advisory).toContain("exceeds what your loaded fleet does well");
		expect(verdict.advisory).toContain("gemma-4-31b");
		expect(verdict.advisory).toContain("Your call.");
	});

	it("names cloud only as an escape hatch, honest about whether it is enabled", () => {
		const off = assessCeilingAdvisory({
			cardDifficulty: 0.9,
			role: "worker",
			bestAvailableCapability: 0.4,
			routedModelKey: null,
		});
		expect(off.advisory).toContain("once you enable that");
		const on = assessCeilingAdvisory({
			cardDifficulty: 0.9,
			role: "worker",
			bestAvailableCapability: 0.4,
			routedModelKey: null,
			cloudEnabled: true,
		});
		expect(on.advisory).toContain("a cloud model would resolve it more reliably");
		expect(on.advisory).not.toContain("once you enable");
	});

	it("stays silent within the margin (normal fleet stretch)", () => {
		const verdict = assessCeilingAdvisory({
			cardDifficulty: 0.6,
			role: "worker",
			bestAvailableCapability: 0.5,
			routedModelKey: "m",
		});
		expect(verdict.exceedsFleet).toBe(false);
		expect(verdict.advisory).toBeNull();
	});

	it("stays silent on unmeasured capability (no false alarm on thin data)", () => {
		const verdict = assessCeilingAdvisory({
			cardDifficulty: 0.99,
			role: "reviewer",
			bestAvailableCapability: null,
			routedModelKey: "m",
		});
		expect(verdict.exceedsFleet).toBe(false);
		expect(verdict.advisory).toBeNull();
	});

	it("honors a custom margin", () => {
		const tight = assessCeilingAdvisory({
			cardDifficulty: 0.7,
			role: "worker",
			bestAvailableCapability: 0.5,
			routedModelKey: "m",
			margin: 0.1,
		});
		expect(tight.exceedsFleet).toBe(true);
	});
});

// F12.105 surface contract: the marker prefix the board UI extracts from the selection reason.
describe("ceiling advisory surface marker (F12.105)", () => {
	it("matches the board's extraction regex when stamped on a selection reason", () => {
		const verdict = assessCeilingAdvisory({
			cardDifficulty: 0.9,
			role: "worker",
			bestAvailableCapability: 0.4,
			routedModelKey: "small-model",
		});
		expect(verdict.exceedsFleet).toBe(true);
		const selectionReason = `Routed to small-model. Capability-ceiling advisory: ${verdict.advisory}`;
		const extracted = selectionReason.match(/Capability-ceiling advisory:.*$/u)?.[0] ?? null;
		expect(extracted).not.toBeNull();
		expect(extracted).toContain(verdict.advisory ?? "");
	});

	it("stamps nothing when the fleet clears the card (no toast, no noise)", () => {
		const verdict = assessCeilingAdvisory({
			cardDifficulty: 0.3,
			role: "worker",
			bestAvailableCapability: 0.8,
			routedModelKey: "strong-model",
		});
		expect(verdict.exceedsFleet).toBe(false);
		expect(verdict.advisory).toBeNull();
	});
});
