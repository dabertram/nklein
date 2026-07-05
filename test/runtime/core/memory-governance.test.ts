import { describe, expect, it } from "vitest";
import {
	isMemoryAccessAllowed,
	markMemoryDeleted,
	scoreMemoryImportance,
	supersedeMemory,
} from "../../../src/core/memory-governance";

describe("isMemoryAccessAllowed (namespaced scope enforcement)", () => {
	it("allows a note whose namespace is in the session's scope", () => {
		expect(isMemoryAccessAllowed({ allowedNamespaces: ["ws-abc", "global"], noteNamespace: "ws-abc" })).toBe(true);
		expect(isMemoryAccessAllowed({ allowedNamespaces: ["ws-abc", "global"], noteNamespace: "global" })).toBe(true);
	});

	it("denies another project's namespace unless explicitly scoped (no access-all)", () => {
		expect(isMemoryAccessAllowed({ allowedNamespaces: ["ws-abc"], noteNamespace: "ws-other" })).toBe(false);
		expect(isMemoryAccessAllowed({ allowedNamespaces: [], noteNamespace: "global" })).toBe(false);
	});
});

describe("scoreMemoryImportance (recency × frequency × importance)", () => {
	it("a fresh, often-recalled, important note outscores an old, cold, unimportant one", () => {
		const hot = scoreMemoryImportance({ ageDays: 0, accessCount: 50, importance: 1 });
		const cold = scoreMemoryImportance({ ageDays: 400, accessCount: 0, importance: 0.1 });
		expect(hot).toBeGreaterThan(cold);
		expect(hot).toBeLessThanOrEqual(1);
		expect(cold).toBeGreaterThanOrEqual(0);
	});

	it("no single signal zeroes the score (each keeps a floor)", () => {
		// Never accessed + old, but important → still > 0 (not wiped).
		expect(scoreMemoryImportance({ ageDays: 1000, accessCount: 0, importance: 1 })).toBeGreaterThan(0);
	});

	it("defaults importance to 0.5 and clamps out-of-range importance", () => {
		const def = scoreMemoryImportance({ ageDays: 0, accessCount: 3 });
		const over = scoreMemoryImportance({ ageDays: 0, accessCount: 3, importance: 5 });
		const under = scoreMemoryImportance({ ageDays: 0, accessCount: 3, importance: -5 });
		expect(over).toBeGreaterThan(def); // 1 > 0.5
		expect(under).toBe(0); // clamped to 0 ⇒ score 0
	});

	it("more accesses ⇒ higher score (saturating frequency)", () => {
		const few = scoreMemoryImportance({ ageDays: 0, accessCount: 1, importance: 0.8 });
		const many = scoreMemoryImportance({ ageDays: 0, accessCount: 100, importance: 0.8 });
		expect(many).toBeGreaterThan(few);
	});
});

describe("supersedeMemory (contradiction-replacement, reversible)", () => {
	it("records the supersede + keeps the old note (reversible, non-destructive)", () => {
		const rev = supersedeMemory("notes/old.md", "notes/new.md", "audit contradicted");
		expect(rev).toEqual({
			supersededRef: "notes/old.md",
			replacementRef: "notes/new.md",
			reason: "audit contradicted",
			reversible: true,
		});
	});
});

describe("markMemoryDeleted (soft, reversible)", () => {
	it("marks deleted without destroying (retained on disk, reversible)", () => {
		const del = markMemoryDeleted("notes/stale.md", "user pruned");
		expect(del).toEqual({ ref: "notes/stale.md", deleted: true, reason: "user pruned", reversible: true });
	});
});
