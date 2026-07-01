import { describe, expect, it } from "vitest";
import {
	type GrantPosture,
	reconcileSkillCapabilityGrant,
	skillGrantHasOverreach,
} from "../../../src/core/skill-capability-grant-reconcile";
import type { ParsedSkillManifest } from "../../../src/core/skill-md-parse";

/** A minimal manifest; override `allowedTools` (and, rarely, `name`) per case. `undefined` allowedTools = undeclared. */
function manifest(overrides: Partial<ParsedSkillManifest> = {}): ParsedSkillManifest {
	return { name: "test-skill", description: "A harmless skill.", extra: {}, ...overrides };
}

/** Reconcile and return just the posture, for terse assertions. */
function postureFor(allowedTools: string[] | undefined, allowedSet: readonly string[]): GrantPosture {
	return reconcileSkillCapabilityGrant(manifest({ allowedTools }), allowedSet).posture;
}

describe("reconcileSkillCapabilityGrant — deny-all postures (undeclared vs explicit empty)", () => {
	it("undeclared allowed-tools → deny-all with posture 'undeclared' (nothing requested, nothing granted)", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: undefined }), ["editor", "read_files"]);
		expect(g.posture).toBe("undeclared");
		expect(g.granted).toEqual([]);
		expect(g.denied).toEqual([]);
		expect(g.effectiveTools).toEqual([]);
		expect(g.reason).toMatch(/deny-all/);
		expect(g.reason).toMatch(/declared no allowed-tools/);
	});

	it("explicit allowed-tools: [] → deny-all with the DISTINCT posture 'empty_declaration'", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: [] }), ["editor"]);
		expect(g.posture).toBe("empty_declaration");
		expect(g.granted).toEqual([]);
		expect(g.effectiveTools).toEqual([]);
		expect(g.reason).toMatch(/explicitly declared an empty/);
	});

	it("undeclared and explicit-empty are DIFFERENT postures for the same (empty) grant", () => {
		expect(postureFor(undefined, ["editor"])).toBe("undeclared");
		expect(postureFor([], ["editor"])).toBe("empty_declaration");
	});

	it("deny-all holds even when the host permits many tools (least privilege: unrequested ⇒ ungranted)", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: undefined }), ["a", "b", "c", "d"]);
		expect(g.effectiveTools).toEqual([]);
	});
});

describe("reconcileSkillCapabilityGrant — intersection rule (granted = declared ∩ allowed)", () => {
	it("fully granted when every declared tool is in the host allowed set", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files", "editor"] }), [
			"editor",
			"read_files",
			"write_file",
		]);
		expect(g.posture).toBe("fully_granted");
		expect(g.granted).toEqual(["editor", "read_files"]); // sorted
		expect(g.effectiveTools).toEqual(["editor", "read_files"]);
		expect(g.denied).toEqual([]);
		expect(g.reason).toMatch(/fully granted/);
	});

	it("partially granted: strips the over-reaching tools, keeps the permitted ones", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files", "curl", "editor"] }), [
			"read_files",
			"editor",
		]);
		expect(g.posture).toBe("partially_granted");
		expect(g.granted).toEqual(["editor", "read_files"]);
		expect(g.effectiveTools).toEqual(["editor", "read_files"]);
		expect(g.denied).toHaveLength(1);
		expect(g.denied[0].tool).toBe("curl");
		expect(g.denied[0].reason).toBe("not_in_allowed_set");
		expect(g.reason).toMatch(/partially granted/);
	});

	it("fully denied: declared tools present, but NONE in the host set → empty effective grant", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["curl", "wget", "ssh"] }), [
			"read_files",
			"editor",
		]);
		expect(g.posture).toBe("fully_denied");
		expect(g.granted).toEqual([]);
		expect(g.effectiveTools).toEqual([]);
		expect(g.denied.map((d) => d.tool)).toEqual(["curl", "ssh", "wget"]); // sorted, all denied
		expect(g.reason).toMatch(/fully denied/);
	});

	it("union is NEVER used: a host tool the skill did not declare is not granted", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files"] }), [
			"read_files",
			"editor",
			"x",
		]);
		expect(g.granted).toEqual(["read_files"]);
		expect(g.effectiveTools).toEqual(["read_files"]);
	});

	it("effectiveTools always equals granted (intersection ⇒ they are the same set)", () => {
		for (const [declared, allowed] of [
			[
				["a", "b"],
				["a", "b", "c"],
			],
			[["a", "z"], ["a"]],
			[["p"], ["q"]],
		] as const) {
			const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: [...declared] }), allowed);
			expect(g.effectiveTools).toEqual(g.granted);
		}
	});
});

describe("reconcileSkillCapabilityGrant — denied entries carry a machine-stable reason + detail", () => {
	it("each denied tool has code 'not_in_allowed_set' and a detail naming the tool", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["shell"] }), ["read_files"]);
		expect(g.denied[0]).toEqual({
			tool: "shell",
			reason: "not_in_allowed_set",
			detail: expect.stringContaining("shell"),
		});
	});

	it("denied list is sorted by tool name (stable, comparable output)", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["zeta", "alpha", "mike"] }), []);
		expect(g.denied.map((d) => d.tool)).toEqual(["alpha", "mike", "zeta"]);
	});
});

describe("reconcileSkillCapabilityGrant — normalisation + defensiveness (injected values, fail-safe)", () => {
	it("trims whitespace on both sides so ' editor ' declared matches 'editor' allowed", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: [" editor "] }), ["editor"]);
		expect(g.posture).toBe("fully_granted");
		expect(g.granted).toEqual(["editor"]);
	});

	it("de-duplicates declared tools (post-trim collisions collapse to one)", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["editor", " editor", "editor "] }), ["editor"]);
		expect(g.granted).toEqual(["editor"]);
		expect(g.posture).toBe("fully_granted");
	});

	it("drops blank / non-string entries from the host allowed set rather than trusting them", () => {
		// A mis-typed config: blanks + a non-string must not widen (or corrupt) the grant.
		const dirty = ["read_files", "", "   ", 42, null, undefined, "editor"] as unknown as string[];
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files", "editor", "curl"] }), dirty);
		expect(g.granted).toEqual(["editor", "read_files"]);
		expect(g.denied.map((d) => d.tool)).toEqual(["curl"]);
	});

	it("a non-array host allowed set degrades to deny-everything-declared, never throws", () => {
		const g = reconcileSkillCapabilityGrant(
			manifest({ allowedTools: ["read_files"] }),
			undefined as unknown as string[],
		);
		expect(g.posture).toBe("fully_denied");
		expect(g.granted).toEqual([]);
	});

	it("an empty host allowed set denies every declared tool", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files", "editor"] }), []);
		expect(g.posture).toBe("fully_denied");
		expect(g.denied.map((d) => d.tool)).toEqual(["editor", "read_files"]);
	});

	it("falls back to 'skill' in the reason when the manifest name is blank", () => {
		const g = reconcileSkillCapabilityGrant(manifest({ name: "   ", allowedTools: undefined }), []);
		expect(g.reason).toContain("'skill'");
	});
});

describe("reconcileSkillCapabilityGrant — purity + totality", () => {
	it("is deterministic: identical inputs yield deeply-equal grants", () => {
		const m = manifest({ allowedTools: ["b", "a", "curl"] });
		const set = ["a", "b"];
		expect(reconcileSkillCapabilityGrant(m, set)).toEqual(reconcileSkillCapabilityGrant(m, set));
	});

	it("does not mutate the injected manifest or its allowedTools array", () => {
		const tools = ["curl", "read_files"];
		const m = manifest({ allowedTools: tools });
		const snapshot = [...tools];
		reconcileSkillCapabilityGrant(m, ["read_files"]);
		expect(tools).toEqual(snapshot);
		expect(m.allowedTools).toBe(tools);
	});

	it("does not mutate the injected allowed set array", () => {
		const set = ["read_files", "editor"];
		const snapshot = [...set];
		reconcileSkillCapabilityGrant(manifest({ allowedTools: ["read_files"] }), set);
		expect(set).toEqual(snapshot);
	});
});

describe("skillGrantHasOverreach — convenience predicate", () => {
	it("true when at least one declared tool is stripped", () => {
		expect(skillGrantHasOverreach(manifest({ allowedTools: ["read_files", "curl"] }), ["read_files"])).toBe(true);
	});

	it("false when the skill is fully granted", () => {
		expect(skillGrantHasOverreach(manifest({ allowedTools: ["read_files"] }), ["read_files", "editor"])).toBe(false);
	});

	it("false for undeclared / explicit-empty skills (nothing declared to strip)", () => {
		expect(skillGrantHasOverreach(manifest({ allowedTools: undefined }), ["editor"])).toBe(false);
		expect(skillGrantHasOverreach(manifest({ allowedTools: [] }), ["editor"])).toBe(false);
	});

	it("agrees with the full reconcile result", () => {
		const m = manifest({ allowedTools: ["a", "b", "z"] });
		const set = ["a", "b"];
		expect(skillGrantHasOverreach(m, set)).toBe(reconcileSkillCapabilityGrant(m, set).denied.length > 0);
	});
});
