import { describe, expect, it } from "vitest";
import { detectPinDrift, type PinnedArtifact } from "../../../src/core/skill-pin-drift";

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
