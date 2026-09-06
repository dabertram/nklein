import { describe, expect, it } from "vitest";
import { classifyVolatilePath, formatVolatilePathWarning } from "../../src/core/volatile-runtime-path";

const darwin = { tmpdir: "/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T", platform: "darwin" as const };
const linux = { tmpdir: "/tmp", platform: "linux" as const };

describe("classifyVolatilePath (2026-09-06 dirhelper sweep)", () => {
	it("flags the macOS per-user temp folder — the drain root that lost its provider selection", () => {
		const verdict = classifyVolatilePath(
			"/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T/real-drain-MniEmY/home/.nklein/nklein",
			darwin,
		);
		expect(verdict?.sweeper).toBe("macos_dirhelper");
		expect(verdict?.detail).toContain("03:35");
	});

	it("sees through the /private prefix and a trailing slash", () => {
		expect(
			classifyVolatilePath("/private/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T/real-drain-MniEmY/ws/", darwin)
				?.sweeper,
		).toBe("macos_dirhelper");
	});

	it("does not flag the sibling caches folder or a durable home path", () => {
		expect(classifyVolatilePath("/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/C/com.apple.x", darwin)).toBeNull();
		expect(classifyVolatilePath("/Users/david/.nklein/nklein", darwin)).toBeNull();
		expect(classifyVolatilePath("/Users/david/GIT/nklein", darwin)).toBeNull();
	});

	it("flags /tmp (and /private/tmp) with the platform's janitor", () => {
		expect(classifyVolatilePath("/tmp/claude-501/scratch", darwin)?.sweeper).toBe("tmp_cleaner");
		expect(classifyVolatilePath("/private/tmp/claude-501/scratch", darwin)?.detail).toContain("tmp_cleaner");
		expect(classifyVolatilePath("/tmp/run", linux)?.detail).toContain("systemd-tmpfiles");
	});

	it("falls back to the process tmpdir for other platforms/layouts", () => {
		const custom = { tmpdir: "/scratch/tmp", platform: "linux" as const };
		expect(classifyVolatilePath("/scratch/tmp/run-1", custom)?.sweeper).toBe("os_tmpdir");
		expect(classifyVolatilePath("/scratch/tmpfoo/run-1", custom)).toBeNull();
		expect(classifyVolatilePath("/home/u/project", custom)).toBeNull();
	});

	it("ignores blank input", () => {
		expect(classifyVolatilePath("   ", darwin)).toBeNull();
	});
});

describe("formatVolatilePathWarning", () => {
	it("names the role, the path, the sweeper detail, and the remedy", () => {
		const verdict = classifyVolatilePath("/tmp/x", linux);
		if (!verdict) {
			throw new Error("expected a verdict");
		}
		const line = formatVolatilePathWarning(verdict, "The runtime home");
		expect(line).toContain("The runtime home /tmp/x");
		expect(line).toContain("systemd-tmpfiles");
		expect(line).toContain("durable location");
	});
});
