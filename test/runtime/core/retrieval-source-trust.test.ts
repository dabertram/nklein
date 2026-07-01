import { describe, expect, it } from "vitest";
import {
	DEFAULT_TRUST_WEIGHT,
	isCitableWithoutCorroboration,
	type SourceTrustTier,
	scoreSourceTrust,
	toEvidenceTrustTier,
} from "../../../src/core/retrieval-source-trust";
import { retrievedEvidenceSchema } from "../../../src/core/retrieved-evidence";

describe("scoreSourceTrust — TLD-class signals", () => {
	it("treats government / mil / edu / int TLDs as authoritative", () => {
		expect(scoreSourceTrust("https://www.nasa.gov/mission").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://army.mil/news").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://cs.stanford.edu/paper").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.un.int/").tier).toBe("authoritative");
	});

	it("recognises two-label institutional suffixes (.gov.uk / .ac.uk / .edu.au / .gov.au)", () => {
		expect(scoreSourceTrust("https://www.gov.uk/guidance").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.cam.ac.uk/research").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.unimelb.edu.au/").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.australia.gov.au/").tier).toBe("authoritative");
	});

	it("records the matched TLD signal and marks basis=signal", () => {
		const t = scoreSourceTrust("https://data.gov/dataset");
		expect(t.basis).toBe("signal");
		expect(t.matchedSignals).toContain("gov-tld");
		expect(t.host).toBe("data.gov");
	});

	it("does not fire a two-label suffix on the wrong host (edu.au vs a plain .au)", () => {
		// A plain `.au` with no institutional prefix is not authoritative — falls through to default community.
		expect(scoreSourceTrust("https://shop.example.au/").tier).toBe("community");
	});
});

describe("scoreSourceTrust — reputable host lexicon", () => {
	it("scores major references / research / DOI as reputable", () => {
		expect(scoreSourceTrust("https://en.wikipedia.org/wiki/Monoid").tier).toBe("reputable");
		expect(scoreSourceTrust("https://arxiv.org/abs/2401.00001").tier).toBe("reputable");
		expect(scoreSourceTrust("https://doi.org/10.1000/xyz").tier).toBe("reputable");
		expect(scoreSourceTrust("https://www.nature.com/articles/x").tier).toBe("reputable");
	});

	it("scores standards bodies as authoritative", () => {
		expect(scoreSourceTrust("https://www.w3.org/TR/html5/").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://datatracker.ietf.org/doc/rfc9110/").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.iso.org/standard/1.html").tier).toBe("authoritative");
		expect(scoreSourceTrust("https://www.who.int/data").tier).toBe("authoritative");
	});

	it("matches a registrable-domain suffix, not a bare substring (anti-spoof)", () => {
		// `wikipedia.org.evil.com` must NOT be treated as wikipedia.
		const spoof = scoreSourceTrust("https://wikipedia.org.evil.com/page");
		expect(spoof.tier).toBe("community"); // unrecognised host → default
		expect(spoof.matchedSignals).not.toContain("major-reference");
		// The legit subdomain still matches.
		expect(scoreSourceTrust("https://de.m.wikipedia.org/wiki/X").tier).toBe("reputable");
	});
});

describe("scoreSourceTrust — community / user-generated content", () => {
	it("scores Q&A + social + blogs as community", () => {
		expect(scoreSourceTrust("https://stackoverflow.com/questions/1").tier).toBe("community");
		expect(scoreSourceTrust("https://www.reddit.com/r/x/comments/1").tier).toBe("community");
		expect(scoreSourceTrust("https://someone.medium.com/post").tier).toBe("community");
		expect(scoreSourceTrust("https://blog.substack.com/p/x").tier).toBe("community");
		expect(scoreSourceTrust("https://x.fandom.com/wiki/Y").tier).toBe("community");
	});

	it("caps a user-content host at community EVEN under an authoritative TLD (blog on a university domain)", () => {
		// A personal blog subdomain on an .edu host: the edu-tld signal fires (would be authoritative), but the
		// `blog` label is user content → capped to community. Fails safe toward skepticism.
		const t = scoreSourceTrust("https://blog.cs.stanford.edu/rant");
		expect(t.tier).toBe("community");
		expect(t.matchedSignals).toContain("edu-tld");
		expect(t.matchedSignals).toContain("blog-subdomain");
	});

	it("does NOT cap when the reputable signal is itself the highest and no user-content fired", () => {
		const t = scoreSourceTrust("https://docs.example.com/api");
		expect(t.tier).toBe("reputable");
		expect(t.matchedSignals).toContain("vendor-docs");
	});
});

describe("scoreSourceTrust — host-label keyword cues", () => {
	it("reads docs/developer/api/support subdomains as vendor docs (reputable)", () => {
		expect(scoreSourceTrust("https://developer.mozilla-example.com/").tier).toBe("reputable");
		expect(scoreSourceTrust("https://api.example.com/reference").tier).toBe("reputable");
		expect(scoreSourceTrust("https://support.example.com/kb").tier).toBe("reputable");
	});

	it("reads blog/forum/community/wiki/answers subdomains as community (user content)", () => {
		expect(scoreSourceTrust("https://forum.example.com/t/1").tier).toBe("community");
		expect(scoreSourceTrust("https://community.example.com/topic").tier).toBe("community");
		expect(scoreSourceTrust("https://wiki.example.com/Page").tier).toBe("community");
		expect(scoreSourceTrust("https://answers.example.com/q/1").tier).toBe("community");
	});

	it("fires a label cue on a discrete host label, not a substring of one", () => {
		// `docsend.example.com` should NOT match the `docs?` label cue (whole-label regex).
		const t = scoreSourceTrust("https://docsend.example.com/view");
		expect(t.matchedSignals).not.toContain("vendor-docs");
		expect(t.tier).toBe("community"); // no signal → default
	});
});

describe("scoreSourceTrust — most-authoritative-wins precedence", () => {
	it("picks the most authoritative tier when multiple positive signals fire", () => {
		// docs.<standards-body>: both vendor-docs (reputable) and standards-body (authoritative) fire → authoritative.
		const t = scoreSourceTrust("https://docs.ietf.org/spec");
		expect(t.tier).toBe("authoritative");
		expect(t.matchedSignals).toContain("standards-body");
		expect(t.matchedSignals).toContain("vendor-docs");
	});

	it("records every distinct signal that fired, in lexicon order (deterministic)", () => {
		const a = scoreSourceTrust("https://docs.w3.org/thing");
		const b = scoreSourceTrust("https://docs.w3.org/thing");
		expect(a.matchedSignals).toEqual(b.matchedSignals);
		// TLD rules are scanned before host rules before label cues, so standards-body precedes vendor-docs.
		expect(a.matchedSignals).toEqual(["standards-body", "vendor-docs"]);
	});
});

describe("scoreSourceTrust — unplaceable / hostless origins", () => {
	it("returns unknown for an empty / whitespace ref", () => {
		expect(scoreSourceTrust("").tier).toBe("unknown");
		expect(scoreSourceTrust("   ").basis).toBe("unknown");
	});

	it("returns unknown for a non-http scheme (mailto/file/data)", () => {
		expect(scoreSourceTrust("mailto:someone@example.com").tier).toBe("unknown");
		expect(scoreSourceTrust("file:///etc/hosts").tier).toBe("unknown");
		expect(scoreSourceTrust("data:text/plain,hi").tier).toBe("unknown");
	});

	it("returns unknown for an IP-literal host (no domain to reason about)", () => {
		expect(scoreSourceTrust("http://127.0.0.1:8080/x").tier).toBe("unknown");
		expect(scoreSourceTrust("https://[::1]/x").tier).toBe("unknown");
		expect(scoreSourceTrust("https://192.168.1.5/admin").host).toBeNull();
	});

	it("accepts a bare host or host/path (treated as https)", () => {
		expect(scoreSourceTrust("wikipedia.org").tier).toBe("reputable");
		expect(scoreSourceTrust("example.gov/data").tier).toBe("authoritative");
		expect(scoreSourceTrust("example.com").host).toBe("example.com");
	});
});

describe("scoreSourceTrust — declared source KIND priors", () => {
	it("uses the doc kind as a reputable prior when there is no host", () => {
		const t = scoreSourceTrust("", { sourceType: "doc" });
		expect(t.tier).toBe("reputable");
		expect(t.basis).toBe("kind");
		expect(t.host).toBeNull();
	});

	it("uses the repo kind as a community prior when there is no host", () => {
		const t = scoreSourceTrust("mailto:x@y.z", { sourceType: "repo" });
		expect(t.tier).toBe("community");
		expect(t.basis).toBe("kind");
	});

	it("web / mcp kinds carry NO prior → unknown when hostless", () => {
		expect(scoreSourceTrust("", { sourceType: "web" }).tier).toBe("unknown");
		expect(scoreSourceTrust("", { sourceType: "mcp" }).tier).toBe("unknown");
	});

	it("a real host's domain signal takes precedence over the kind prior", () => {
		// Even though this is a `repo`, the wikipedia host wins → reputable via signal, not the repo/community prior.
		const t = scoreSourceTrust("https://en.wikipedia.org/wiki/X", { sourceType: "repo" });
		expect(t.tier).toBe("reputable");
		expect(t.basis).toBe("signal");
	});
});

describe("scoreSourceTrust — default for a placeable-but-unknown host", () => {
	it("defaults an unrecognised plain website to community (basis=default, no signals)", () => {
		const t = scoreSourceTrust("https://www.some-random-site.com/article");
		expect(t.tier).toBe("community");
		expect(t.basis).toBe("default");
		expect(t.matchedSignals).toEqual([]);
		expect(t.host).toBe("www.some-random-site.com");
	});

	it("never returns authoritative/reputable without a positive signal", () => {
		const t = scoreSourceTrust("https://blogpostaggregator.example.net/");
		expect(["community", "unknown", "low"]).toContain(t.tier);
	});
});

describe("scoreSourceTrust — weights", () => {
	it("assigns the default tier weight, ordered authoritative > reputable > community > unknown > low", () => {
		expect(scoreSourceTrust("https://x.gov/").weight).toBe(DEFAULT_TRUST_WEIGHT.authoritative);
		expect(scoreSourceTrust("https://arxiv.org/abs/1").weight).toBe(DEFAULT_TRUST_WEIGHT.reputable);
		expect(scoreSourceTrust("https://reddit.com/r/x").weight).toBe(DEFAULT_TRUST_WEIGHT.community);
		expect(scoreSourceTrust("").weight).toBe(DEFAULT_TRUST_WEIGHT.unknown);
		expect(DEFAULT_TRUST_WEIGHT.authoritative).toBeGreaterThan(DEFAULT_TRUST_WEIGHT.reputable);
		expect(DEFAULT_TRUST_WEIGHT.reputable).toBeGreaterThan(DEFAULT_TRUST_WEIGHT.community);
		expect(DEFAULT_TRUST_WEIGHT.community).toBeGreaterThan(DEFAULT_TRUST_WEIGHT.unknown);
		expect(DEFAULT_TRUST_WEIGHT.unknown).toBeGreaterThan(DEFAULT_TRUST_WEIGHT.low);
	});

	it("all default weights are within [0,1]", () => {
		for (const w of Object.values(DEFAULT_TRUST_WEIGHT)) {
			expect(w).toBeGreaterThanOrEqual(0);
			expect(w).toBeLessThanOrEqual(1);
		}
	});

	it("honours a partial weight override, keeping defaults for the rest", () => {
		const t = scoreSourceTrust("https://x.gov/", { weights: { authoritative: 0.9 } });
		expect(t.weight).toBe(0.9);
		expect(scoreSourceTrust("https://reddit.com/r/x", { weights: { authoritative: 0.9 } }).weight).toBe(
			DEFAULT_TRUST_WEIGHT.community,
		);
	});
});

describe("scoreSourceTrust — caller-supplied extra rules", () => {
	it("honours extra host rules (e.g. an internal wiki promoted to reputable)", () => {
		const t = scoreSourceTrust("https://kb.internal-corp.example/page", {
			extraHostRules: [{ suffix: "internal-corp.example", tier: "reputable", signal: "internal-kb" }],
		});
		expect(t.tier).toBe("reputable");
		expect(t.matchedSignals).toContain("internal-kb");
	});

	it("honours extra TLD rules", () => {
		const t = scoreSourceTrust("https://ministry.example.test/", {
			extraTldRules: [{ tld: "test", tier: "authoritative", signal: "test-tld" }],
		});
		expect(t.tier).toBe("authoritative");
		expect(t.matchedSignals).toContain("test-tld");
	});

	it("honours an extra low-trust label cue that caps to community", () => {
		const t = scoreSourceTrust("https://mirror.example.edu/", {
			extraLabelCues: [{ label: /^mirror$/, tier: "community", signal: "mirror-host", userContent: true }],
		});
		expect(t.tier).toBe("community");
		expect(t.matchedSignals).toContain("mirror-host");
	});
});

describe("scoreSourceTrust — determinism + purity", () => {
	it("is a pure function of its inputs (repeated calls agree exactly)", () => {
		const refs = [
			"https://www.nasa.gov/x",
			"https://stackoverflow.com/q/1",
			"https://docs.example.com/",
			"mailto:x@y.z",
			"",
		];
		for (const ref of refs) {
			expect(scoreSourceTrust(ref)).toEqual(scoreSourceTrust(ref));
		}
	});

	it("carries a non-empty guidance rail for every tier", () => {
		const tiers: SourceTrustTier[] = ["authoritative", "reputable", "community", "unknown", "low"];
		const byTier: Record<SourceTrustTier, string> = {
			authoritative: scoreSourceTrust("https://x.gov/").guidance,
			reputable: scoreSourceTrust("https://arxiv.org/1").guidance,
			community: scoreSourceTrust("https://reddit.com/r/x").guidance,
			unknown: scoreSourceTrust("").guidance,
			low: scoreSourceTrust("https://x/", {
				extraHostRules: [{ suffix: "x", tier: "low", signal: "flagged" }],
			}).guidance,
		};
		for (const tier of tiers) {
			expect(byTier[tier].length).toBeGreaterThan(0);
		}
	});
});

describe("toEvidenceTrustTier — maps onto retrieved-evidence.ts enum", () => {
	it("folds authoritative + reputable → trusted, community → community, unknown + low → untrusted", () => {
		expect(toEvidenceTrustTier("authoritative")).toBe("trusted");
		expect(toEvidenceTrustTier("reputable")).toBe("trusted");
		expect(toEvidenceTrustTier("community")).toBe("community");
		expect(toEvidenceTrustTier("unknown")).toBe("untrusted");
		expect(toEvidenceTrustTier("low")).toBe("untrusted");
	});

	it("produces values the RetrievedEvidence schema accepts (integration with §5.AC envelope)", () => {
		const derived = toEvidenceTrustTier(scoreSourceTrust("https://en.wikipedia.org/wiki/X").tier);
		const envelope = {
			sourceType: "web" as const,
			fetchedAt: "2026-06-28T00:00:00Z",
			contentHash: "deadbeef",
			trustTier: derived,
			extractionSpans: [],
			citationIds: [],
			promptInjectionRiskFlags: [],
		};
		// The derived tier must be a legal value for the evidence envelope's trustTier field.
		expect(() => retrievedEvidenceSchema.parse(envelope)).not.toThrow();
		expect(derived).toBe("trusted");
	});
});

describe("isCitableWithoutCorroboration", () => {
	it("clears authoritative + reputable, blocks the rest", () => {
		expect(isCitableWithoutCorroboration("authoritative")).toBe(true);
		expect(isCitableWithoutCorroboration("reputable")).toBe(true);
		expect(isCitableWithoutCorroboration("community")).toBe(false);
		expect(isCitableWithoutCorroboration("unknown")).toBe(false);
		expect(isCitableWithoutCorroboration("low")).toBe(false);
	});

	it("agrees with the tier a real source scores to", () => {
		expect(isCitableWithoutCorroboration(scoreSourceTrust("https://www.iso.org/x").tier)).toBe(true);
		expect(isCitableWithoutCorroboration(scoreSourceTrust("https://stackoverflow.com/q/1").tier)).toBe(false);
	});
});
