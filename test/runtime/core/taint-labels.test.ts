import { describe, expect, it } from "vitest";
import {
	type InfluenceKind,
	isProtectedInfluence,
	isTainted,
	isUntrustedTaintLabel,
	labelsForSource,
	PROTECTED_INFLUENCE_KINDS,
	propagateTaint,
	TAINT_LABELS,
	type TaintLabel,
	type TaintSourceKind,
	taintedContentMayInfluence,
} from "../../../src/core/taint-labels";

describe("taint-labels vocabulary (§5.L)", () => {
	it("defines exactly the §5.L label union", () => {
		expect([...TAINT_LABELS]).toEqual([
			"repo_instruction",
			"web",
			"mcp",
			"private_repo",
			"secret_like",
			"user_trusted",
			"runtime_policy",
		]);
	});

	it("classifies the five untrusted-to-influence labels", () => {
		const untrusted: TaintLabel[] = ["repo_instruction", "web", "mcp", "private_repo", "secret_like"];
		for (const label of untrusted) {
			expect(isUntrustedTaintLabel(label)).toBe(true);
		}
	});

	it("keeps user_trusted and runtime_policy as trusted anchors", () => {
		expect(isUntrustedTaintLabel("user_trusted")).toBe(false);
		expect(isUntrustedTaintLabel("runtime_policy")).toBe(false);
	});

	it("has no label that is both trusted and untrusted", () => {
		const untrustedCount = TAINT_LABELS.filter(isUntrustedTaintLabel).length;
		expect(untrustedCount).toBe(5);
		expect(TAINT_LABELS.length - untrustedCount).toBe(2);
	});
});

describe("labelsForSource — attach labels to a content source", () => {
	it("maps each source kind to its base label", () => {
		const cases: [TaintSourceKind, TaintLabel][] = [
			["web", "web"],
			["repo", "repo_instruction"],
			["private_repo", "private_repo"],
			["mcp", "mcp"],
			["user", "user_trusted"],
			["runtime_policy", "runtime_policy"],
		];
		for (const [kind, expected] of cases) {
			expect(labelsForSource(kind)).toEqual([expected]);
		}
	});

	it("layers secret_like on top when the content looks secret-like", () => {
		expect(labelsForSource("private_repo", { looksSecretLike: true })).toEqual(["private_repo", "secret_like"]);
		expect(labelsForSource("web", { looksSecretLike: true })).toEqual(["web", "secret_like"]);
	});

	it("does not duplicate secret_like when it is already the base", () => {
		// There is no `secret_like` source kind, but a user-authored secret still only carries secret_like once
		// alongside its base — guard against accidental duplication on any base.
		expect(labelsForSource("user", { looksSecretLike: true })).toEqual(["user_trusted", "secret_like"]);
	});

	it("treats an absent context the same as no secret hint", () => {
		expect(labelsForSource("web")).toEqual(labelsForSource("web", {}));
		expect(labelsForSource("web", { looksSecretLike: false })).toEqual(["web"]);
	});

	it("only ever emits real TaintLabels", () => {
		const kinds: TaintSourceKind[] = ["web", "repo", "private_repo", "mcp", "user", "runtime_policy"];
		for (const kind of kinds) {
			for (const label of labelsForSource(kind, { looksSecretLike: true })) {
				expect(TAINT_LABELS).toContain(label);
			}
		}
	});
});

describe("propagateTaint — labels accumulate into context", () => {
	it("unions existing and incoming labels", () => {
		expect(propagateTaint(["user_trusted"], ["web"])).toEqual(["web", "user_trusted"]);
	});

	it("de-duplicates and returns canonical order", () => {
		// Input order is scrambled; output must follow TAINT_LABELS order regardless.
		const result = propagateTaint(["mcp", "web"], ["web", "repo_instruction", "mcp"]);
		expect(result).toEqual(["repo_instruction", "web", "mcp"]);
	});

	it("cannot launder untrusted provenance by mixing with trusted text", () => {
		// Web content mingled into a user-trusted prompt leaves the prompt web-tainted forever.
		const merged = propagateTaint(["user_trusted"], ["web"]);
		expect(isTainted(merged)).toBe(true);
	});

	it("is a no-op union when nothing new arrives", () => {
		expect(propagateTaint(["web"], [])).toEqual(["web"]);
		expect(propagateTaint([], ["web"])).toEqual(["web"]);
		expect(propagateTaint([], [])).toEqual([]);
	});

	it("equal label sets compare equal as arrays regardless of input order", () => {
		const a = propagateTaint(["web", "mcp"], []);
		const b = propagateTaint(["mcp"], ["web"]);
		expect(a).toEqual(b);
	});
});

describe("isTainted", () => {
	it("is false for empty and trusted-only label sets", () => {
		expect(isTainted([])).toBe(false);
		expect(isTainted(["user_trusted"])).toBe(false);
		expect(isTainted(["user_trusted", "runtime_policy"])).toBe(false);
	});

	it("is true if any untrusted label is present", () => {
		expect(isTainted(["web"])).toBe(true);
		expect(isTainted(["user_trusted", "mcp"])).toBe(true);
		expect(isTainted(["runtime_policy", "secret_like"])).toBe(true);
	});
});

describe("protected influence kinds", () => {
	it("lists exactly the §5.L protected sinks", () => {
		expect([...PROTECTED_INFLUENCE_KINDS]).toEqual([
			"capabilities",
			"approvals",
			"network",
			"secrets",
			"git_delivery",
			"host_access",
		]);
	});

	it("marks every protected kind as protected and style as unprotected", () => {
		for (const kind of PROTECTED_INFLUENCE_KINDS) {
			expect(isProtectedInfluence(kind)).toBe(true);
		}
		expect(isProtectedInfluence("style")).toBe(false);
	});
});

describe("taintedContentMayInfluence — THE core §5.L rule", () => {
	const everyContext: TaintLabel[][] = [
		[],
		["user_trusted"],
		["runtime_policy"],
		["web"],
		["mcp"],
		["repo_instruction"],
		["private_repo"],
		["secret_like"],
		["user_trusted", "web"],
	];

	it("always allows style-class influence, even from the most tainted context", () => {
		for (const labels of everyContext) {
			expect(taintedContentMayInfluence({ labels, influence: "style" })).toBe(true);
		}
	});

	it("allows a protected influence from an untainted context (no plan needed)", () => {
		for (const kind of PROTECTED_INFLUENCE_KINDS) {
			expect(taintedContentMayInfluence({ labels: ["user_trusted"], influence: kind })).toBe(true);
			expect(taintedContentMayInfluence({ labels: [], influence: kind })).toBe(true);
		}
	});

	it("DENIES every protected influence from tainted content without a trusted plan", () => {
		const taintedContexts: TaintLabel[][] = [
			["web"],
			["mcp"],
			["repo_instruction"],
			["private_repo"],
			["secret_like"],
			["user_trusted", "web"], // trusted anchor does NOT rescue tainted context
		];
		for (const labels of taintedContexts) {
			for (const kind of PROTECTED_INFLUENCE_KINDS) {
				expect(taintedContentMayInfluence({ labels, influence: kind })).toBe(false);
			}
		}
	});

	it("permits a protected influence from tainted content ONLY with a trusted plan + confirmation", () => {
		for (const kind of PROTECTED_INFLUENCE_KINDS) {
			expect(
				taintedContentMayInfluence({
					labels: ["web"],
					influence: kind,
					backedByTrustedPlanAndConfirmation: true,
				}),
			).toBe(true);
		}
	});

	it("treats a trusted plan as irrelevant for style (already allowed) and requires the exact true flag", () => {
		// A style influence is allowed with or without the flag.
		expect(
			taintedContentMayInfluence({ labels: ["web"], influence: "style", backedByTrustedPlanAndConfirmation: false }),
		).toBe(true);
		// The gate is strictly `=== true`: falsy/absent never rescues a protected sink.
		expect(
			taintedContentMayInfluence({
				labels: ["web"],
				influence: "network",
				backedByTrustedPlanAndConfirmation: false,
			}),
		).toBe(false);
		expect(taintedContentMayInfluence({ labels: ["web"], influence: "network" })).toBe(false);
	});

	it("is exhaustive: every (context × influence) is decided as expected", () => {
		const influences: InfluenceKind[] = ["style", ...PROTECTED_INFLUENCE_KINDS];
		for (const labels of everyContext) {
			for (const influence of influences) {
				const decided = taintedContentMayInfluence({ labels, influence });
				const expected = !isProtectedInfluence(influence) || !isTainted(labels); // no plan supplied in this sweep
				expect(decided).toBe(expected);
			}
		}
	});
});
