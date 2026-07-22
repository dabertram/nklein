import { describe, expect, it } from "vitest";
import {
	assessTerminalBenchAgentBoundary,
	assessTerminalBenchHost,
	PINNED_HARBOR_VERSION,
	planTerminalBenchOracleSmoke,
	TERMINAL_BENCH_21_DATASET,
} from "../../../src/core/terminal-bench-harness";

describe("Terminal-Bench 2.1 harness preflight", () => {
	it("plans the official bounded oracle command without executing or pulling images", () => {
		expect(
			planTerminalBenchOracleSmoke({ outputDir: "/evidence/tb21", limit: 5, harborPath: "/opt/harbor" }),
		).toEqual({
			command: "/opt/harbor",
			args: ["run", "-d", TERMINAL_BENCH_21_DATASET, "-a", "oracle", "-l", "5", "-o", "/evidence/tb21"],
		});
	});

	it("becomes host-ready only with the pinned harness, reachable Docker, and real free headroom", () => {
		expect(
			assessTerminalBenchHost({
				harborVersion: PINNED_HARBOR_VERSION,
				dockerReachable: true,
				dockerArchitecture: "amd64",
				availableBytes: 41,
				reclaimableDockerBytes: 0,
				requiredFreeBytes: 40,
			}),
		).toMatchObject({ ready: true, blockers: [] });
	});

	it("does not treat reclaimable Docker cache as already-free disk", () => {
		const result = assessTerminalBenchHost({
			harborVersion: PINNED_HARBOR_VERSION,
			dockerReachable: true,
			dockerArchitecture: "aarch64",
			availableBytes: 28,
			reclaimableDockerBytes: 14,
			requiredFreeBytes: 40,
		});
		expect(result.ready).toBe(false);
		expect(result.blockers.join(" ")).toContain("Only 28 bytes are free");
		expect(result.warnings.join(" ")).toContain("not counted as free");
		expect(result.warnings.join(" ")).toContain("aarch64");
	});

	it("names the externally-owned mutable-container seam instead of pretending the repo sandbox is equivalent", () => {
		const result = assessTerminalBenchAgentBoundary({
			execInOwnedContainer: false,
			mutableRootFilesystem: false,
			copyFilesToAndFromContainer: true,
			preserveContainerAcrossTurns: false,
			harborOwnsVerification: true,
		});
		expect(result.ready).toBe(false);
		expect(result.blockers).toHaveLength(3);
		expect(result.blockers.join(" ")).toContain("Harbor's task container");
	});

	it("accepts only a complete Harbor-owned task-container boundary", () => {
		expect(
			assessTerminalBenchAgentBoundary({
				execInOwnedContainer: true,
				mutableRootFilesystem: true,
				copyFilesToAndFromContainer: true,
				preserveContainerAcrossTurns: true,
				harborOwnsVerification: true,
			}),
		).toEqual({ ready: true, blockers: [] });
	});
});
