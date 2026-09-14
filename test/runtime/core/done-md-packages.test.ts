import { describe, expect, it } from "vitest";
import { parseDoneMarkdownPackages, slugifyDoneHeading } from "../../../src/core/done-md-packages";

/**
 * F2.36 (a): done.md's coarse sections already name their milestones as `### ` sub-headers; the self board should
 * show those milestones as packages instead of one 126-item blob.
 */
const DONE = `# Done
intro

## 2026-07-13 Phase 0 stop-the-line fixes

- [x] **P0.1 — first fix** text
- [x] **P0.2 — second fix** text

### 5.A — Strict isolation

- [x] **5.A.1 — isolate** text
  continuation line

### 5.K — Second-opinion reviewer ✅ *(complete)*

- [x] **5.K.1 — reviewer** text

## 2026-07-23 N13 double-run flake quarantine

- [x] **N13 — quarantine** text

## Header-only section

### Only milestone

- [x] **M.1 — item** text
`;

describe("parseDoneMarkdownPackages", () => {
	it("splits a section into its own items plus one package per ### milestone, in document order", () => {
		const packages = parseDoneMarkdownPackages(DONE);
		expect(packages.map((pkg) => [pkg.id, pkg.itemCount])).toEqual([
			["done:2026-07-13-phase-0-stop-the-line-fixes", 2],
			["done:2026-07-13-phase-0-stop-the-line-fixes--5-a-strict-isolation", 1],
			["done:2026-07-13-phase-0-stop-the-line-fixes--5-k-second-opinion-reviewer-complete", 1],
			["done:2026-07-23-n13-double-run-flake-quarantine", 1],
			["done:header-only-section--only-milestone", 1],
		]);
	});

	it("titles a milestone after its section and says where its items come from", () => {
		const milestone = parseDoneMarkdownPackages(DONE)[1];
		expect(milestone?.title).toBe("2026-07-13 Phase 0 stop-the-line fixes — 5.A — Strict isolation");
		expect(milestone?.prompt).toContain('milestone "5.A — Strict isolation"');
		expect(milestone?.prompt).toContain("- **5.A.1 — isolate** text");
	});

	it("keeps the plain-section id stable (the cards existing boards already carry) and skips an empty header", () => {
		const ids = parseDoneMarkdownPackages(DONE).map((pkg) => pkg.id);
		expect(ids).toContain("done:2026-07-23-n13-double-run-flake-quarantine");
		expect(ids.some((id) => id === "done:header-only-section")).toBe(false);
		expect(slugifyDoneHeading("6. SHIPPED — already implemented (do not rebuild)")).toBe(
			"6-shipped-already-implemented-do-not-rebuild",
		);
	});

	it("clamps the prompt through the caller's budget", () => {
		const [first] = parseDoneMarkdownPackages(DONE, (text) => text.slice(0, 12));
		expect(first?.prompt.endsWith("- **P0.1 — f")).toBe(true);
	});
});
