import { describe, expect, it } from "vitest";
import { DEFAULT_MCP_WORKER_HEADROOM_MB, decideMcpServerMemoryFit } from "../../../src/core/mcp-server-memory-fit";

const CODEBASE_MEMORY_BUDGET_MB = 2048; // matches the SANDBOX_MCP_SERVERS entry
const DEFAULT_CONTAINER_MB = 4096; // the 2026-07-11 OOM container size

describe("decideMcpServerMemoryFit", () => {
	it("offers when the container limit is unbounded/unknown (no per-container OOM gate)", () => {
		for (const containerMemoryLimitMb of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			const decision = decideMcpServerMemoryFit({
				serverId: "codebase-memory",
				memoryBudgetMb: CODEBASE_MEMORY_BUDGET_MB,
				containerMemoryLimitMb,
			});
			expect(decision.offer).toBe(true);
			expect(decision.reason).toMatch(/unbounded|unknown/);
		}
	});

	it("WITHHOLDS the heavy codebase-memory (2 GB) on the 4 GB default container (the OOM fix)", () => {
		// 2048 budget + 2560 worker headroom = 4608 required > 4096 available ⇒ withheld.
		const decision = decideMcpServerMemoryFit({
			serverId: "codebase-memory",
			memoryBudgetMb: CODEBASE_MEMORY_BUDGET_MB,
			containerMemoryLimitMb: DEFAULT_CONTAINER_MB,
		});
		expect(decision.offer).toBe(false);
		expect(decision.reason).toMatch(/withheld/);
		expect(decision.reason).toMatch(/OOM/);
	});

	it("OFFERS codebase-memory on a 6 GB+ container (room for budget + baseline + a concurrent build/test)", () => {
		for (const containerMemoryLimitMb of [6144, 8192, 16384]) {
			const decision = decideMcpServerMemoryFit({
				serverId: "codebase-memory",
				memoryBudgetMb: CODEBASE_MEMORY_BUDGET_MB,
				containerMemoryLimitMb,
			});
			expect(decision.offer).toBe(true);
			expect(decision.reason).toMatch(/fits/);
		}
	});

	it("offers at exactly budget + headroom (the boundary is inclusive)", () => {
		const containerMemoryLimitMb = CODEBASE_MEMORY_BUDGET_MB + DEFAULT_MCP_WORKER_HEADROOM_MB; // 4608
		expect(
			decideMcpServerMemoryFit({
				serverId: "codebase-memory",
				memoryBudgetMb: CODEBASE_MEMORY_BUDGET_MB,
				containerMemoryLimitMb,
			}).offer,
		).toBe(true);
		// One MB below the boundary ⇒ withheld.
		expect(
			decideMcpServerMemoryFit({
				serverId: "codebase-memory",
				memoryBudgetMb: CODEBASE_MEMORY_BUDGET_MB,
				containerMemoryLimitMb: containerMemoryLimitMb - 1,
			}).offer,
		).toBe(false);
	});

	it("OFFERS the lightweight scaffolds (256/512 MB) on the same 4 GB container that withholds codebase-memory", () => {
		for (const memoryBudgetMb of [256, 512]) {
			const decision = decideMcpServerMemoryFit({
				serverId: "sequential-thinking",
				memoryBudgetMb,
				containerMemoryLimitMb: DEFAULT_CONTAINER_MB,
			});
			expect(decision.offer).toBe(true);
		}
	});

	it("honors an explicit workerHeadroomMb override", () => {
		// A generous headroom pushes even a lightweight server past a small container.
		const decision = decideMcpServerMemoryFit({
			serverId: "sequential-thinking",
			memoryBudgetMb: 256,
			containerMemoryLimitMb: 2048,
			workerHeadroomMb: 4096,
		});
		expect(decision.offer).toBe(false); // 256 + 4096 = 4352 > 2048
	});
});
