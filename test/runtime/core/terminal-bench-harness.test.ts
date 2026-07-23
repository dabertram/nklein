import { describe, expect, it } from "vitest";
import {
	assessTerminalBenchAgentBoundary,
	assessTerminalBenchHost,
	PINNED_HARBOR_VERSION,
	planTerminalBenchAgentSmoke,
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

	it("plans a matched custom-agent smoke while keeping Harbor as dataset and verifier authority", () => {
		expect(
			planTerminalBenchAgentSmoke({
				outputDir: "/evidence/tb21/nklein",
				cwd: "/repo",
				modelId: "local/model",
				baseUrl: "http://127.0.0.1:1234/v1",
				contextWindow: 32_768,
				maxTokensPerTurn: 4_096,
				limit: 5,
				harborPath: "/opt/harbor",
			}),
		).toMatchObject({
			command: "/opt/harbor",
			cwd: "/repo",
			args: expect.arrayContaining([
				"--agent-import-path",
				"integrations.harbor.nklein_harbor_agent:NKleinHarborAgent",
			]),
			env: { NKLEIN_TERMINAL_MODEL_ID: "local/model", NKLEIN_TERMINAL_CONTEXT_WINDOW: "32768" },
		});
		expect(() =>
			planTerminalBenchAgentSmoke({
				outputDir: "/evidence/tb21/nklein",
				cwd: "/repo",
				modelId: "remote/model",
				baseUrl: "https://api.example.com/v1",
				contextWindow: 32_768,
				maxTokensPerTurn: 4_096,
			}),
		).toThrow(/private LAN/);
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
			boundedExecResults: true,
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
				boundedExecResults: true,
				preserveContainerAcrossTurns: true,
				harborOwnsVerification: true,
			}),
		).toEqual({ ready: true, blockers: [] });
	});
});
