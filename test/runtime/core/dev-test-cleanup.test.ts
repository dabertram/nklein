import { describe, expect, it } from "vitest";
import { type DevTestCleanupEntry, formatBytes, summarizeDevTestCleanup } from "../../../src/core/dev-test-cleanup";

const ENTRIES: DevTestCleanupEntry[] = [
	{ path: "/tmp/active", kind: "dev_test_workspace", sizeBytes: 10_000, isActive: true },
	{ path: "/tmp/old-1", kind: "dev_test_workspace", sizeBytes: 28_500_000, isActive: false },
	{ path: "vol-1", kind: "sandbox_volume", sizeBytes: 2_000_000, isActive: false },
	{ path: "~/Library/.../chat", kind: "editor_cache", sizeBytes: 9_160_000_000, isActive: false },
];

describe("summarizeDevTestCleanup", () => {
	it("never reclaims the active run and reports retained vs reclaimable totals", () => {
		const report = summarizeDevTestCleanup(ENTRIES);
		expect(report.retained.map((entry) => entry.path)).toEqual(["/tmp/active"]);
		expect(report.totalRetainedBytes).toBe(10_000);
		expect(report.totalReclaimableBytes).toBe(28_500_000 + 2_000_000 + 9_160_000_000);
		expect(report.reclaimable).toHaveLength(3);
	});

	it("groups reclaimable/retained bytes by kind", () => {
		const report = summarizeDevTestCleanup(ENTRIES);
		const workspace = report.categories.find((category) => category.kind === "dev_test_workspace");
		expect(workspace).toMatchObject({
			reclaimableBytes: 28_500_000,
			reclaimableCount: 1,
			retainedBytes: 10_000,
			retainedCount: 1,
		});
		const editor = report.categories.find((category) => category.kind === "editor_cache");
		expect(editor?.reclaimableBytes).toBe(9_160_000_000);
	});

	it("handles an empty input", () => {
		const report = summarizeDevTestCleanup([]);
		expect(report.totalReclaimableBytes).toBe(0);
		expect(report.categories).toEqual([]);
	});
});

describe("formatBytes", () => {
	it("formats bytes into human units", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(28_500_000)).toBe("27 MiB");
		expect(formatBytes(9_160_000_000)).toBe("8.5 GiB");
	});
});
