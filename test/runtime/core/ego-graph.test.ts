import { describe, expect, it } from "vitest";
import { buildSymbolEgoGraph, type EgoFileFacts } from "../../../src/core/ego-graph";

const file = (path: string, over: Partial<Omit<EgoFileFacts, "path">> = {}): EgoFileFacts => ({
	path,
	symbols: [],
	referencedIdentifiers: [],
	importedPaths: [],
	...over,
});

/** router declares route(); handler uses route + declares handle(); ui references handle; util is unrelated. */
const GRAPH: EgoFileFacts[] = [
	file("src/router.ts", {
		symbols: [{ name: "route", kind: "function", line: 10 }],
		referencedIdentifiers: ["parse"],
		importedPaths: ["src/parse.ts"],
	}),
	file("src/handler.ts", {
		symbols: [{ name: "handle", kind: "function", line: 5 }],
		referencedIdentifiers: ["route"],
		importedPaths: ["src/router.ts"],
	}),
	file("src/ui.ts", { symbols: [], referencedIdentifiers: ["handle"], importedPaths: ["src/handler.ts"] }),
	file("src/parse.ts", { symbols: [{ name: "parse", kind: "function", line: 3 }] }),
	file("src/unrelated.ts", { symbols: [{ name: "misc", kind: "function", line: 1 }] }),
];

describe("buildSymbolEgoGraph (F11.2c)", () => {
	it("walks declaration → users → their neighborhood in BFS hops, never reaching unrelated files", () => {
		const result = buildSymbolEgoGraph(["route"], GRAPH, { k: 2 });
		expect(result.seedsMatched).toEqual(["route"]);
		expect(result.seedsUnmatched).toEqual([]);
		// Hop 0: the declaration site with its exact line.
		expect(result.targets[0]).toEqual({
			path: "src/router.ts",
			line: 10,
			symbol: "route",
			hop: 0,
			via: "declares route",
		});
		// Hop 1: handler references route; parse is used by router; import edges both directions.
		const hop1 = result.targets.filter((target) => target.hop === 1);
		expect(hop1.map((target) => target.path)).toContain("src/handler.ts");
		expect(hop1.map((target) => target.path)).toContain("src/parse.ts");
		// Hop 2: ui references handle (declared in the hop-1 handler file).
		const hop2 = result.targets.filter((target) => target.hop === 2);
		expect(hop2.some((target) => target.path === "src/ui.ts" && target.symbol === "handle")).toBe(true);
		// The unrelated file never enters the neighborhood.
		expect(result.targets.every((target) => target.path !== "src/unrelated.ts")).toBe(true);
	});

	it("k=1 stops at the immediate neighborhood", () => {
		const result = buildSymbolEgoGraph(["route"], GRAPH, { k: 1 });
		expect(result.targets.every((target) => target.hop <= 1)).toBe(true);
		expect(result.targets.some((target) => target.path === "src/ui.ts")).toBe(false);
	});

	it("localizes a seed with no local declaration via its referencing files, honestly labeled", () => {
		const result = buildSymbolEgoGraph(
			["externalApi"],
			[file("src/a.ts", { referencedIdentifiers: ["externalApi"] }), file("src/b.ts", {})],
		);
		expect(result.seedsMatched).toEqual(["externalApi"]);
		expect(result.targets).toEqual([
			{
				path: "src/a.ts",
				line: null,
				symbol: "externalApi",
				hop: 0,
				via: "references externalApi (declared outside the scan)",
			},
		]);
	});

	it("reports unmatched seeds and caps targets with the truncated flag (closest neighborhood survives)", () => {
		const noHit = buildSymbolEgoGraph(["nope"], GRAPH);
		expect(noHit.seedsUnmatched).toEqual(["nope"]);
		expect(noHit.targets).toEqual([]);
		const capped = buildSymbolEgoGraph(["route"], GRAPH, { k: 2, maxTargets: 2 });
		expect(capped.targets).toHaveLength(2);
		expect(capped.truncated).toBe(true);
		expect(capped.targets[0]?.hop).toBe(0);
	});

	it("prunes high-fan-out hub names from expansion (reported, seeds exempt)", () => {
		// `lines` is a generic local declared in the seed file and referenced by 10 files — following it would
		// pull the whole repo in. The seed itself stays expandable however popular.
		const hubGraph: EgoFileFacts[] = [
			file("src/seed.ts", {
				symbols: [
					{ name: "route", kind: "function", line: 1 },
					{ name: "lines", kind: "const", line: 2 },
				],
			}),
			...Array.from({ length: 10 }, (_, index) =>
				file(`src/noise-${index}.ts`, { referencedIdentifiers: ["lines"] }),
			),
			file("src/real-user.ts", { referencedIdentifiers: ["route"] }),
		];
		const result = buildSymbolEgoGraph(["route"], hubGraph, { k: 2 });
		expect(result.hubNamesPruned).toEqual(["lines"]);
		expect(result.targets.some((target) => target.path.startsWith("src/noise-"))).toBe(false);
		expect(result.targets.some((target) => target.path === "src/real-user.ts")).toBe(true);
		// The same popular name AS SEED is never pruned — the user asked for it.
		const asSeed = buildSymbolEgoGraph(["lines"], hubGraph, { k: 1 });
		expect(asSeed.seedsMatched).toEqual(["lines"]);
		expect(asSeed.targets.length).toBeGreaterThan(1);
	});

	it("is deterministic regardless of input file order", () => {
		const reversed = [...GRAPH].reverse();
		expect(buildSymbolEgoGraph(["route"], reversed, { k: 2 })).toEqual(
			buildSymbolEgoGraph(["route"], GRAPH, { k: 2 }),
		);
	});
});
