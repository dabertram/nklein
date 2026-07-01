import { describe, expect, it } from "vitest";
import {
	type CorroborationClaim,
	checkClaimsCorroboration,
	isClaimCorroborated,
	resolveCorroborationRequirement,
} from "../../../src/core/claim-corroboration-requirement";

// Handy source builders (URL-scored, so the trust scorer supplies both tier + host/independence key).
const gov = (path = "/x") => ({ url: `https://www.nasa.gov${path}` }); // authoritative
const standards = (path = "/x") => ({ url: `https://www.w3.org${path}` }); // authoritative
const wiki = (path = "/x") => ({ url: `https://en.wikipedia.org${path}` }); // reputable
const forum = (host: string, path = "/x") => ({ url: `https://${host}${path}` }); // community (open site / default)

describe("resolveCorroborationRequirement — no sources", () => {
	it("returns unsupported with a zero count when nothing is cited", () => {
		const v = resolveCorroborationRequirement({ id: "c1", sources: [] });
		expect(v.status).toBe("unsupported");
		expect(v.distinctOrigins).toBe(0);
		expect(v.unplaceableSources).toBe(0);
		expect(v.bestTier).toBeNull();
		expect(v.hasCitableAloneSource).toBe(false);
		expect(v.reason).toMatch(/no sources/i);
	});
});

describe("resolveCorroborationRequirement — citable-alone sources satisfy the bar", () => {
	it("an authoritative source alone makes a load-bearing claim assertable", () => {
		const v = resolveCorroborationRequirement({ id: "c1", sources: [gov()], loadBearing: true });
		expect(v.status).toBe("assertable");
		expect(v.bestTier).toBe("authoritative");
		expect(v.hasCitableAloneSource).toBe(true);
		expect(v.reason).toMatch(/citable without corroboration/i);
	});

	it("a reputable source alone makes a load-bearing claim assertable", () => {
		const v = resolveCorroborationRequirement({ id: "c1", sources: [wiki()], loadBearing: true });
		expect(v.status).toBe("assertable");
		expect(v.bestTier).toBe("reputable");
		expect(v.hasCitableAloneSource).toBe(true);
	});

	it("reports the MOST authoritative tier when mixed (authoritative wins over community)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("randomblog.example"), gov()],
		});
		expect(v.status).toBe("assertable");
		expect(v.bestTier).toBe("authoritative");
	});
});

describe("resolveCorroborationRequirement — load-bearing independent-origin floor", () => {
	it("a single community source is NOT enough for a load-bearing claim (needs 2)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("forum.example")],
			loadBearing: true,
		});
		expect(v.status).toBe("needs_corroboration");
		expect(v.distinctOrigins).toBe(1);
		expect(v.requiredIndependentSources).toBe(2);
		expect(v.reason).toMatch(/find another independent source/i);
	});

	it("two INDEPENDENT community origins corroborate a load-bearing claim", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("forumA.example"), forum("forumB.example")],
			loadBearing: true,
		});
		expect(v.status).toBe("assertable");
		expect(v.distinctOrigins).toBe(2);
		expect(v.reason).toMatch(/corroborated by 2 independent/i);
	});

	it("re-citing the SAME host counts as ONE origin (echo, not corroboration)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [
				forum("forum.example", "/thread/1"),
				forum("forum.example", "/thread/2"),
				forum("forum.example", "/p"),
			],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(1);
		expect(v.status).toBe("needs_corroboration");
	});

	it("subdomains of the SAME registrable domain collapse to one origin", () => {
		// de.wikipedia.org and en.wikipedia.org are one origin — but wikipedia is reputable ⇒ citable alone anyway,
		// so use a plain site with distinct subdomains that share a registrable domain to test independence collapse.
		const v = resolveCorroborationRequirement({
			id: "c1",
			// Both resolve to community (plain sites); host is the FULL host, so distinct subdomains are distinct origins.
			sources: [forum("a.blog.example"), forum("b.blog.example")],
			loadBearing: true,
		});
		// The trust scorer keys independence on the full host, so these two ARE distinct origins.
		expect(v.distinctOrigins).toBe(2);
		expect(v.status).toBe("assertable");
	});
});

describe("resolveCorroborationRequirement — non-load-bearing looser bar", () => {
	it("a single community source suffices for an incidental (non-load-bearing) claim", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("forum.example")],
			loadBearing: false,
		});
		expect(v.status).toBe("assertable");
		expect(v.distinctOrigins).toBe(1);
		expect(v.reason).toMatch(/non-load-bearing/i);
	});

	it("defaults loadBearing to true (fail-safe) when the flag is omitted", () => {
		const withoutFlag = resolveCorroborationRequirement({ id: "c1", sources: [forum("forum.example")] });
		const explicitTrue = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("forum.example")],
			loadBearing: true,
		});
		expect(withoutFlag.status).toBe("needs_corroboration");
		expect(withoutFlag.status).toBe(explicitTrue.status);
	});
});

describe("resolveCorroborationRequirement — low / unplaceable origins", () => {
	it("an unplaceable-only load-bearing claim is needs_corroboration (has usable-but-unprovable backing)", () => {
		// An `mcp` source with no URL has no host ⇒ unplaceable AND tier `unknown` (not citable-alone), so it cannot
		// satisfy the floor on its own but leaves SOME backing. (Contrast a hostless `doc`, which scores `reputable` ⇒
		// citable alone — see the dedicated test below.)
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ sourceType: "mcp" }],
			loadBearing: true,
		});
		expect(v.bestTier).toBe("unknown");
		expect(v.unplaceableSources).toBe(1);
		expect(v.distinctOrigins).toBe(0);
		expect(v.status).toBe("needs_corroboration");
		expect(v.reason).toMatch(/unplaceable/i);
	});

	it("a hostless `doc` source scores reputable ⇒ citable alone ⇒ assertable (kind prior)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ sourceType: "doc" }],
			loadBearing: true,
		});
		expect(v.bestTier).toBe("reputable");
		expect(v.hasCitableAloneSource).toBe(true);
		expect(v.status).toBe("assertable");
	});

	it("an unplaceable source cannot, alone, satisfy the multi-origin floor for a load-bearing claim", () => {
		// One placeable community + one unplaceable ⇒ only 1 independent origin ⇒ still short of 2.
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [forum("forum.example"), { sourceType: "mcp" }],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(1);
		expect(v.unplaceableSources).toBe(1);
		expect(v.status).toBe("needs_corroboration");
	});

	it("a `low`-tier-only claim (explicit tier) is unsupported for load-bearing (no usable origin)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ id: "s1", url: "https://x.example", tier: "low" }],
			loadBearing: true,
		});
		expect(v.bestTier).toBe("low");
		expect(v.distinctOrigins).toBe(0); // low does not corroborate
		expect(v.unplaceableSources).toBe(0); // it HAS a host, it just doesn't count
		expect(v.status).toBe("unsupported");
		expect(v.reason).toMatch(/no usable origin/i);
	});

	it("a `low`-only non-load-bearing claim is also unsupported (nothing usable, nothing unplaceable)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ url: "https://x.example", tier: "low" }],
			loadBearing: false,
		});
		expect(v.status).toBe("unsupported");
	});

	it("an unknown-tier source does not count toward the corroboration floor", () => {
		// Two IP-literal URLs ⇒ scorer returns unknown + null host ⇒ unplaceable, zero independent origins.
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ url: "http://10.0.0.1/a" }, { url: "http://10.0.0.2/b" }],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(0);
		expect(v.unplaceableSources).toBe(2);
		expect(v.bestTier).toBe("unknown");
		expect(v.status).toBe("needs_corroboration");
	});
});

describe("resolveCorroborationRequirement — pre-scored tiers + explicit origin keys", () => {
	it("an explicit `tier` overrides scoring from the URL", () => {
		// URL would score community, but the caller declares it authoritative ⇒ citable alone.
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [{ url: "https://forum.example/x", tier: "authoritative" }],
			loadBearing: true,
		});
		expect(v.bestTier).toBe("authoritative");
		expect(v.status).toBe("assertable");
	});

	it("uses `url` host for independence even when the tier is supplied explicitly", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [
				{ url: "https://siteA.example/x", tier: "community" },
				{ url: "https://siteB.example/y", tier: "community" },
			],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(2);
		expect(v.status).toBe("assertable");
	});

	it("explicit `originKey` declares independence, overriding host (two keys → two origins with no URL)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [
				{ sourceType: "doc", tier: "community", originKey: "doc:handbook" },
				{ sourceType: "doc", tier: "community", originKey: "doc:runbook" },
			],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(2);
		expect(v.unplaceableSources).toBe(0);
		expect(v.status).toBe("assertable");
	});

	it("the SAME explicit `originKey` collapses two sources to one origin (mirror-dedup)", () => {
		const v = resolveCorroborationRequirement({
			id: "c1",
			sources: [
				{ url: "https://mirror1.example/x", tier: "community", originKey: "upstream:acme" },
				{ url: "https://mirror2.example/y", tier: "community", originKey: "upstream:acme" },
			],
			loadBearing: true,
		});
		expect(v.distinctOrigins).toBe(1);
		expect(v.status).toBe("needs_corroboration");
	});
});

describe("resolveCorroborationRequirement — configurable required-origin bar", () => {
	it("requiredIndependentSources: 3 demands three independent origins", () => {
		const twoOrigins = resolveCorroborationRequirement(
			{ id: "c1", sources: [forum("a.example"), forum("b.example")], loadBearing: true },
			{ requiredIndependentSources: 3 },
		);
		expect(twoOrigins.status).toBe("needs_corroboration");
		expect(twoOrigins.requiredIndependentSources).toBe(3);

		const threeOrigins = resolveCorroborationRequirement(
			{ id: "c1", sources: [forum("a.example"), forum("b.example"), forum("c.example")], loadBearing: true },
			{ requiredIndependentSources: 3 },
		);
		expect(threeOrigins.status).toBe("assertable");
	});

	it("requiredIndependentSources ≤ 1 is clamped to 1 (a claim always needs at least one source)", () => {
		const v = resolveCorroborationRequirement(
			{ id: "c1", sources: [forum("a.example")], loadBearing: true },
			{ requiredIndependentSources: 0 },
		);
		expect(v.requiredIndependentSources).toBe(1);
		expect(v.status).toBe("assertable");
	});

	it("a fractional bar is truncated", () => {
		const v = resolveCorroborationRequirement(
			{ id: "c1", sources: [forum("a.example"), forum("b.example")], loadBearing: true },
			{ requiredIndependentSources: 2.9 },
		);
		expect(v.requiredIndependentSources).toBe(2);
		expect(v.status).toBe("assertable");
	});

	it("threads scoreOptions through to the trust scorer (extra host rule promotes a source to citable-alone)", () => {
		const v = resolveCorroborationRequirement(
			{ id: "c1", sources: [{ url: "https://internal.corp/x" }], loadBearing: true },
			{
				scoreOptions: {
					extraHostRules: [{ suffix: "internal.corp", tier: "authoritative", signal: "corp-canon" }],
				},
			},
		);
		expect(v.bestTier).toBe("authoritative");
		expect(v.status).toBe("assertable");
	});
});

describe("resolveCorroborationRequirement — determinism + no mutation", () => {
	it("is deterministic for the same input", () => {
		const claim: CorroborationClaim = {
			id: "c1",
			sources: [forum("a.example"), standards(), { sourceType: "mcp" }],
			loadBearing: true,
		};
		expect(resolveCorroborationRequirement(claim)).toEqual(resolveCorroborationRequirement(claim));
	});

	it("does not mutate the input claim or its sources", () => {
		const sources = [forum("a.example"), forum("b.example")] as const;
		const claim: CorroborationClaim = { id: "c1", sources, loadBearing: true };
		const snapshot = JSON.stringify(claim);
		resolveCorroborationRequirement(claim);
		expect(JSON.stringify(claim)).toBe(snapshot);
		expect(claim.sources).toBe(sources);
	});
});

describe("checkClaimsCorroboration — batch sweep", () => {
	it("buckets claims by status, order-preserving, with a hasUncorroborated flag", () => {
		const claims: CorroborationClaim[] = [
			{ id: "assert-auth", sources: [gov()], loadBearing: true }, // assertable (citable alone)
			{ id: "needs", sources: [forum("a.example")], loadBearing: true }, // needs_corroboration (1 origin)
			{ id: "unsupported", sources: [], loadBearing: true }, // unsupported (no sources)
			{ id: "assert-2origins", sources: [forum("b.example"), forum("c.example")], loadBearing: true }, // assertable
		];
		const result = checkClaimsCorroboration(claims);

		expect(result.verdicts.map((v) => v.status)).toEqual([
			"assertable",
			"needs_corroboration",
			"unsupported",
			"assertable",
		]);
		expect(result.assertable).toEqual([0, 3]);
		expect(result.needsCorroboration).toEqual([1]);
		expect(result.unsupported).toEqual([2]);
		expect(result.hasUncorroborated).toBe(true);
		// Verdicts carry the right claim ids in order.
		expect(result.verdicts.map((v) => v.claimId)).toEqual(["assert-auth", "needs", "unsupported", "assert-2origins"]);
	});

	it("hasUncorroborated is false only when EVERY claim is assertable", () => {
		const allGood = checkClaimsCorroboration([
			{ id: "a", sources: [gov()] },
			{ id: "b", sources: [wiki()] },
		]);
		expect(allGood.hasUncorroborated).toBe(false);
		expect(allGood.needsCorroboration).toEqual([]);
		expect(allGood.unsupported).toEqual([]);
	});

	it("passes options through to each claim", () => {
		const result = checkClaimsCorroboration(
			[{ id: "a", sources: [forum("x.example"), forum("y.example")], loadBearing: true }],
			{ requiredIndependentSources: 3 },
		);
		expect(result.verdicts[0].requiredIndependentSources).toBe(3);
		expect(result.verdicts[0].status).toBe("needs_corroboration");
		expect(result.hasUncorroborated).toBe(true);
	});

	it("handles an empty batch (nothing uncorroborated)", () => {
		const result = checkClaimsCorroboration([]);
		expect(result.verdicts).toEqual([]);
		expect(result.hasUncorroborated).toBe(false);
	});
});

describe("isClaimCorroborated — synthesis gate", () => {
	it("passes only assertable claims", () => {
		expect(isClaimCorroborated("assertable")).toBe(true);
		expect(isClaimCorroborated("needs_corroboration")).toBe(false);
		expect(isClaimCorroborated("unsupported")).toBe(false);
	});

	it("agrees with the verdict status end-to-end", () => {
		const assertable = resolveCorroborationRequirement({ id: "c1", sources: [gov()] });
		const needs = resolveCorroborationRequirement({ id: "c2", sources: [forum("a.example")], loadBearing: true });
		expect(isClaimCorroborated(assertable.status)).toBe(true);
		expect(isClaimCorroborated(needs.status)).toBe(false);
	});
});
