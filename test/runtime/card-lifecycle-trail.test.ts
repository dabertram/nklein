import { describe, expect, it } from "vitest";
import {
	buildCardTrail,
	findTrailGaps,
	renderCardTrail,
	type TrailEvent,
	type TrailSourceStatus,
} from "../../src/core/card-lifecycle-trail";

function event(at: number, source: TrailEvent["source"], kind: string, detail = ""): TrailEvent {
	return { at, source, kind, detail };
}

const allAvailable: TrailSourceStatus[] = [
	{ source: "observation", available: true, eventCount: 1, note: "" },
	{ source: "ledger", available: true, eventCount: 1, note: "" },
];

describe("buildCardTrail", () => {
	it("orders events chronologically", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [event(300, "ledger", "c"), event(100, "observation", "a"), event(200, "ledger", "b")],
			sourcesRead: allAvailable,
		});
		expect(trail.events.map((e) => e.kind)).toEqual(["a", "b", "c"]);
	});

	it("is DETERMINISTIC when two events share a timestamp", () => {
		// Two debugging sessions on the same data must not disagree about order — the one thing a forensic tool
		// can never do. Same-timestamp events fall back to a stable source rank, then insertion order.
		const build = () =>
			buildCardTrail({
				cardId: "c1",
				events: [event(100, "observation", "obs"), event(100, "board", "lane"), event(100, "ledger", "led")],
				sourcesRead: allAvailable,
			}).events.map((e) => e.kind);
		expect(build()).toEqual(build());
		expect(build()).toEqual(["lane", "led", "obs"]);
	});

	it("marks the trail PARTIAL when a source could not be read", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [event(1, "observation", "a")],
			sourcesRead: [
				{ source: "observation", available: true, eventCount: 1, note: "" },
				{ source: "log", available: false, eventCount: 0, note: "runtime.log absent" },
			],
		});
		expect(trail.partial).toBe(true);
		expect(trail.summary).toContain("do not read this trail as complete");
	});

	it("distinguishes 'no events' from 'could not read' — the whole point of sourcesRead", () => {
		// A card that genuinely did nothing and a card whose log was deleted look identical without this.
		const quiet = buildCardTrail({
			cardId: "c1",
			events: [],
			sourcesRead: [{ source: "log", available: true, eventCount: 0, note: "" }],
		});
		const broken = buildCardTrail({
			cardId: "c1",
			events: [],
			sourcesRead: [{ source: "log", available: false, eventCount: 0, note: "deleted" }],
		});
		expect(quiet.partial).toBe(false);
		expect(broken.partial).toBe(true);
		expect(quiet.summary).not.toEqual(broken.summary);
	});

	it("says all sources were readable when they were", () => {
		expect(buildCardTrail({ cardId: "c1", events: [], sourcesRead: allAvailable }).summary).toContain(
			"All sources readable",
		);
	});
});

describe("renderCardTrail", () => {
	it("renders an unclocked event without throwing", () => {
		// runtime.log carries no timestamps, so it uses synthetic ordinals; a malformed record can carry 0 or NaN.
		// A forensic tool must never die on the malformed record it exists to show you.
		for (const at of [0, Number.NaN, Number.MAX_SAFE_INTEGER]) {
			const trail = buildCardTrail({ cardId: "c1", events: [event(at, "log", "line")], sourcesRead: [] });
			expect(() => renderCardTrail(trail)).not.toThrow();
			expect(renderCardTrail(trail)).toContain("(no timestamp)");
		}
	});

	it("tells the reader to check sourcesRead before concluding nothing happened", () => {
		const trail = buildCardTrail({ cardId: "c1", events: [], sourcesRead: allAvailable });
		expect(renderCardTrail(trail)).toContain("before concluding nothing happened");
	});

	it("renders metadata verbatim — over-covering is the point", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [{ at: 1_700_000_000_000, source: "ledger", kind: "k", detail: "d", metadata: { leaseId: "abc" } }],
			sourcesRead: allAvailable,
		});
		expect(renderCardTrail(trail)).toContain("leaseId=abc");
	});

	it("omits empty metadata values rather than printing noise", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [{ at: 1_700_000_000_000, source: "ledger", kind: "k", detail: "d", metadata: { a: "", b: null } }],
			sourcesRead: allAvailable,
		});
		expect(renderCardTrail(trail)).not.toContain("a=");
	});
});

describe("findTrailGaps", () => {
	it("finds the quiet period and names what preceded it", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [event(0, "ledger", "start"), event(120_000, "ledger", "end")],
			sourcesRead: allAvailable,
		});
		const gaps = findTrailGaps(trail);
		expect(gaps).toHaveLength(1);
		expect(gaps[0]?.afterKind).toBe("start");
	});

	it("ignores gaps below the threshold", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [event(0, "ledger", "a"), event(1_000, "ledger", "b")],
			sourcesRead: allAvailable,
		});
		expect(findTrailGaps(trail)).toEqual([]);
	});

	it("sorts worst-first", () => {
		const trail = buildCardTrail({
			cardId: "c1",
			events: [event(0, "ledger", "a"), event(70_000, "ledger", "b"), event(500_000, "ledger", "c")],
			sourcesRead: allAvailable,
		});
		expect(findTrailGaps(trail)[0]?.afterKind).toBe("b");
	});

	it("handles a single-event trail", () => {
		const trail = buildCardTrail({ cardId: "c1", events: [event(0, "ledger", "a")], sourcesRead: [] });
		expect(findTrailGaps(trail)).toEqual([]);
	});
});
