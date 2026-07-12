import { describe, expect, it } from "vitest";
import {
	buildSkillContentPreimage,
	decideSkillImport,
	isSkillImportBlocked,
	recordSkillImportPin,
	type SkillImportDecisionInput,
	type SkillImportPin,
	skillImportNeedsFullReview,
	worstSkillImportFriction,
} from "../../../src/core/skill-import-decision";

/** Minimal input builder — defaults to a trusted, clean, first-time import. */
function input(overrides: Partial<SkillImportDecisionInput> = {}): SkillImportDecisionInput {
	return {
		trust: { trust: "trusted", origin: "github.com/anthropics/skills" },
		prescreen: { verdict: "safe" },
		bundled: { verdict: "safe" },
		contentHash: "hash-v1",
		priorPin: null,
		...overrides,
	};
}

const pin = (contentHash: string): SkillImportPin => ({
	skillId: "anthropics/skills#pdf",
	contentHash,
	pinnedAt: "2026-07-13T00:00:00Z",
});

describe("decideSkillImport — hard reject dominates", () => {
	it("blocks a reject-level prescreen verdict even from a trusted source", () => {
		const r = decideSkillImport(input({ prescreen: { verdict: "reject" } }));
		expect(r.decision).toBe("reject");
		expect(r.friction).toBe("blocked");
		expect(r.requiresReconfirm).toBe(false);
		expect(r.reasons).toContain("hard_reject_prescreen");
		expect(isSkillImportBlocked(r)).toBe(true);
	});

	it("blocks a reject-level bundled verdict", () => {
		const r = decideSkillImport(input({ bundled: { verdict: "reject" } }));
		expect(r.decision).toBe("reject");
		expect(r.friction).toBe("blocked");
		expect(r.reasons).toEqual(["hard_reject_bundled"]); // prescreen is safe here, so only the bundled reason
	});

	it("a reject is not laundered by an unchanged pin (TOFU never grandfathers a known-bad marker)", () => {
		const r = decideSkillImport(input({ prescreen: { verdict: "reject" }, priorPin: pin("hash-v1") }));
		expect(r.decision).toBe("reject");
		expect(r.friction).toBe("blocked");
	});

	it("surfaces both reject reasons worst-first when prescreen and bundled both reject", () => {
		const r = decideSkillImport(input({ prescreen: { verdict: "reject" }, bundled: { verdict: "reject" } }));
		expect(r.reasons).toEqual(["hard_reject_prescreen", "hard_reject_bundled"]);
	});
});

describe("decideSkillImport — first-time TOFU import, trust-graduated friction", () => {
	it("trusted + clean ⇒ allow with a light confirm (still explicit — never auto on first import)", () => {
		const r = decideSkillImport(input());
		expect(r.decision).toBe("allow");
		expect(r.friction).toBe("confirm");
		expect(r.pinState).toBe("new");
		expect(r.requiresReconfirm).toBe(true);
		expect(r.reasons).toEqual(["first_import", "trusted_source_clean"]);
	});

	it("untrusted + clean ⇒ full review", () => {
		const r = decideSkillImport(input({ trust: { trust: "untrusted", origin: "lobehub.com" } }));
		expect(r.decision).toBe("review");
		expect(r.friction).toBe("full-review");
		expect(r.requiresReconfirm).toBe(true);
		expect(r.reasons).toContain("untrusted_source");
		expect(r.reasons).toContain("first_import");
		expect(skillImportNeedsFullReview(r)).toBe(true);
	});

	it("trusted but prescreen-review ⇒ full review (a review-level finding overrides the trust discount)", () => {
		const r = decideSkillImport(input({ prescreen: { verdict: "review" } }));
		expect(r.friction).toBe("full-review");
		expect(r.reasons).toContain("prescreen_review");
	});

	it("trusted but bundled-review ⇒ full review", () => {
		const r = decideSkillImport(input({ bundled: { verdict: "review" } }));
		expect(r.friction).toBe("full-review");
		expect(r.reasons).toContain("bundled_review");
	});

	it("a bare SKILL.md (no bundle) is treated as safe on the bundled axis", () => {
		const r = decideSkillImport(input({ bundled: null }));
		expect(r.decision).toBe("allow");
		expect(r.friction).toBe("confirm");
	});
});

describe("decideSkillImport — TOFU pin states", () => {
	it("unchanged pin ⇒ auto (re-import identical bytes with no friction), even for an untrusted origin", () => {
		const r = decideSkillImport(
			input({
				trust: { trust: "untrusted", origin: "lobehub.com" },
				contentHash: "hash-v1",
				priorPin: pin("hash-v1"),
			}),
		);
		expect(r.decision).toBe("allow");
		expect(r.friction).toBe("auto");
		expect(r.pinState).toBe("unchanged");
		expect(r.requiresReconfirm).toBe(false);
		expect(r.reasons).toEqual(["pin_unchanged"]);
	});

	it("changed pin ⇒ full re-review + re-confirm (anti-rug-pull), even for a trusted+clean source", () => {
		const r = decideSkillImport(input({ contentHash: "hash-v2", priorPin: pin("hash-v1") }));
		expect(r.decision).toBe("review");
		expect(r.friction).toBe("full-review");
		expect(r.pinState).toBe("changed");
		expect(r.requiresReconfirm).toBe(true);
		expect(r.reasons[0]).toBe("hash_changed");
	});

	it("changed pin carries the review-level signals alongside hash_changed", () => {
		const r = decideSkillImport(
			input({
				trust: { trust: "untrusted", origin: "x" },
				prescreen: { verdict: "review" },
				contentHash: "v2",
				priorPin: pin("v1"),
			}),
		);
		expect(r.reasons).toEqual(["hash_changed", "untrusted_source", "prescreen_review"]);
	});

	it("a changed hash that now REJECTS is blocked, not merely re-reviewed", () => {
		const r = decideSkillImport(input({ prescreen: { verdict: "reject" }, contentHash: "v2", priorPin: pin("v1") }));
		expect(r.decision).toBe("reject");
		expect(r.friction).toBe("blocked");
	});

	it("an empty-string pinned hash is treated as no pin (new import)", () => {
		const r = decideSkillImport(input({ priorPin: { skillId: "x", contentHash: "", pinnedAt: "t" } }));
		expect(r.pinState).toBe("new");
	});
});

describe("decideSkillImport — totality / defensive", () => {
	it("a malformed verdict degrades toward friction, never toward allow", () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
		const r = decideSkillImport(input({ prescreen: { verdict: "garbage" as any } }));
		expect(r.friction).toBe("full-review");
		expect(r.reasons).toContain("prescreen_review");
	});

	it("a malformed trust value degrades to untrusted", () => {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
		const r = decideSkillImport(input({ trust: { trust: "??" as any, origin: "x" } }));
		expect(r.friction).toBe("full-review");
		expect(r.reasons).toContain("untrusted_source");
	});

	it("does not mutate its inputs", () => {
		const inp = input();
		const snapshot = JSON.stringify(inp);
		decideSkillImport(inp);
		expect(JSON.stringify(inp)).toBe(snapshot);
	});

	it("is deterministic across repeated calls", () => {
		const inp = input({ prescreen: { verdict: "review" }, contentHash: "v2", priorPin: pin("v1") });
		expect(decideSkillImport(inp)).toEqual(decideSkillImport(inp));
	});
});

describe("worstSkillImportFriction", () => {
	it("picks the more-severe friction", () => {
		expect(worstSkillImportFriction("confirm", "full-review")).toBe("full-review");
		expect(worstSkillImportFriction("blocked", "auto")).toBe("blocked");
		expect(worstSkillImportFriction("auto", "auto")).toBe("auto");
		expect(worstSkillImportFriction("confirm", "auto")).toBe("confirm");
	});
});

describe("buildSkillContentPreimage", () => {
	it("is stable regardless of bundled-path order (listing order can't perturb the hash)", () => {
		const a = buildSkillContentPreimage({
			manifestCanonical: "m",
			body: "b",
			bundledPaths: ["scripts/a.sh", "refs/z.md"],
		});
		const b = buildSkillContentPreimage({
			manifestCanonical: "m",
			body: "b",
			bundledPaths: ["refs/z.md", "scripts/a.sh"],
		});
		expect(a).toBe(b);
	});

	it("changes when the body changes", () => {
		const a = buildSkillContentPreimage({ manifestCanonical: "m", body: "b1" });
		const b = buildSkillContentPreimage({ manifestCanonical: "m", body: "b2" });
		expect(a).not.toBe(b);
	});

	it("changes when a bundled file is added (the bundle count is covered)", () => {
		const a = buildSkillContentPreimage({ manifestCanonical: "m", body: "b", bundledPaths: ["x"] });
		const b = buildSkillContentPreimage({ manifestCanonical: "m", body: "b", bundledPaths: ["x", "y"] });
		expect(a).not.toBe(b);
	});

	it("length-prefixing prevents a boundary-forging collision between manifest and body", () => {
		// Without length prefixes, ("ab","") and ("a","b") could collide on a naive join.
		const a = buildSkillContentPreimage({ manifestCanonical: "ab", body: "" });
		const b = buildSkillContentPreimage({ manifestCanonical: "a", body: "b" });
		expect(a).not.toBe(b);
	});

	it("is defensive on non-string parts", () => {
		const malformed = { manifestCanonical: null, body: undefined, bundledPaths: [1, "ok"] } as unknown as Parameters<
			typeof buildSkillContentPreimage
		>[0];
		const r = buildSkillContentPreimage(malformed);
		expect(r).toContain("bundled:1"); // the non-string path was dropped, leaving one
	});
});

describe("recordSkillImportPin", () => {
	it("constructs a pin verbatim (clock injected)", () => {
		expect(recordSkillImportPin("id", "hash", "2026-07-13T00:00:00Z")).toEqual({
			skillId: "id",
			contentHash: "hash",
			pinnedAt: "2026-07-13T00:00:00Z",
		});
	});

	it("round-trips through decideSkillImport as an unchanged pin", () => {
		const p = recordSkillImportPin("id", "hash-v1", "t");
		const r = decideSkillImport(input({ priorPin: p }));
		expect(r.pinState).toBe("unchanged");
		expect(r.friction).toBe("auto");
	});
});
