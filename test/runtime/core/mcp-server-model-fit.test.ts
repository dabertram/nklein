import { describe, expect, it } from "vitest";
import {
	BASIC_MEMORY_FIT,
	CODEBASE_MEMORY_FIT,
	decideMcpServerModelFit,
	decideMcpServerModelFitById,
	type McpServerModelFitProfile,
	SEQUENTIAL_THINKING_FIT,
} from "../../../src/core/mcp-server-model-fit";
import type {
	ChainingStrength,
	ModelCapabilityEntry,
	ModelKind,
	ToolUseVerdict,
} from "../../../src/core/model-capability-catalog";

function entry(
	overrides: Partial<ModelCapabilityEntry> & { toolUse: ToolUseVerdict; kind: ModelKind },
): ModelCapabilityEntry {
	return {
		family: "test-model",
		match: /test-model/,
		note: "fixture",
		sources: [],
		basis: "research",
		...overrides,
	};
}

const capable = (kind: ModelKind, chaining?: ChainingStrength): ModelCapabilityEntry =>
	entry({ toolUse: "TOOL_CAPABLE", kind, ...(chaining ? { chaining } : {}) });

describe("decideMcpServerModelFit — sequential-thinking (the 'for models where it fits' case)", () => {
	it("offers to a non-reasoning, tool-capable model that can chain", () => {
		const d = decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("instruct", "native"));
		expect(d.offer).toBe(true);
	});

	it("SKIPS native-reasoning models (redundant/overthinking) even when otherwise capable", () => {
		const d = decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("reasoning", "native"));
		expect(d.offer).toBe(false);
		expect(d.reason).toContain("reasoning");
	});

	it("SKIPS models below the tool-use floor (TOOL_WEAK < TOOL_CAPABLE)", () => {
		const d = decideMcpServerModelFit(
			SEQUENTIAL_THINKING_FIT,
			entry({ toolUse: "TOOL_WEAK", kind: "instruct", chaining: "native" }),
		);
		expect(d.offer).toBe(false);
		expect(d.reason).toContain("below required");
	});

	it("SKIPS models that cannot sustain a chain (loop/no-progress risk): single_only and fails", () => {
		expect(decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("instruct", "single_only")).offer).toBe(false);
		expect(decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("instruct", "fails")).offer).toBe(false);
	});

	it("offers when chaining is via_force or native (can sustain the loop)", () => {
		expect(decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("agentic", "via_force")).offer).toBe(true);
		expect(decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, capable("agentic", "native")).offer).toBe(true);
	});

	it("SKIPS an UNKNOWN tool-use verdict (fail-safe — loop risk needs known capability)", () => {
		const d = decideMcpServerModelFit(
			SEQUENTIAL_THINKING_FIT,
			entry({ toolUse: "UNKNOWN", kind: "instruct", chaining: "native" }),
		);
		expect(d.offer).toBe(false);
		expect(d.reason).toContain("UNKNOWN");
	});

	it("SKIPS an uncatalogued model (null entry) — fail-safe", () => {
		const d = decideMcpServerModelFit(SEQUENTIAL_THINKING_FIT, null);
		expect(d.offer).toBe(false);
		expect(d.reason).toContain("uncatalogued");
	});
});

describe("decideMcpServerModelFit — codebase-memory (low-risk, broadly useful)", () => {
	it("offers to a native-reasoning model (no reasoning-harm for a stateless query)", () => {
		expect(decideMcpServerModelFit(CODEBASE_MEMORY_FIT, capable("reasoning")).offer).toBe(true);
	});

	it("offers to a TOOL_WEAK model (floor is TOOL_WEAK — a cheap single query is worth attempting)", () => {
		expect(decideMcpServerModelFit(CODEBASE_MEMORY_FIT, entry({ toolUse: "TOOL_WEAK", kind: "code" })).offer).toBe(
			true,
		);
	});

	it("offers to an UNKNOWN tool-use verdict and to an uncatalogued model (offer optimistically)", () => {
		expect(decideMcpServerModelFit(CODEBASE_MEMORY_FIT, entry({ toolUse: "UNKNOWN", kind: "unknown" })).offer).toBe(
			true,
		);
		expect(decideMcpServerModelFit(CODEBASE_MEMORY_FIT, null).offer).toBe(true);
	});

	it("SKIPS a genuinely tool-unsuitable model (schemas it can't use just burn context)", () => {
		const d = decideMcpServerModelFit(CODEBASE_MEMORY_FIT, entry({ toolUse: "TOOL_UNSUITABLE", kind: "chat" }));
		expect(d.offer).toBe(false);
		expect(d.reason).toContain("below required");
	});

	it("does NOT require chaining (a stateless query needs no multi-step loop)", () => {
		expect(decideMcpServerModelFit(CODEBASE_MEMORY_FIT, capable("code", "single_only")).offer).toBe(true);
	});
});

describe("decideMcpServerModelFit — custom profile edge cases", () => {
	it("TOOL_NATIVE clears a TOOL_NATIVE floor; TOOL_CAPABLE does not", () => {
		const strict: McpServerModelFitProfile = { serverId: "x", minToolUse: "TOOL_NATIVE", rationale: "r" };
		expect(decideMcpServerModelFit(strict, entry({ toolUse: "TOOL_NATIVE", kind: "agentic" })).offer).toBe(true);
		expect(decideMcpServerModelFit(strict, entry({ toolUse: "TOOL_CAPABLE", kind: "agentic" })).offer).toBe(false);
	});
});

describe("decideMcpServerModelFitById", () => {
	it("resolves the catalog by id: a gibberish/uncatalogued id → null-entry semantics per profile", () => {
		// Uncatalogued id ⇒ codebase-memory offers optimistically, sequential-thinking fails safe.
		expect(decideMcpServerModelFitById(CODEBASE_MEMORY_FIT, "no-such-model-xyz-999").offer).toBe(true);
		expect(decideMcpServerModelFitById(SEQUENTIAL_THINKING_FIT, "no-such-model-xyz-999").offer).toBe(false);
	});
});

describe("decideMcpServerModelFit — basic-memory (write-capable authored memory: capable-only, fail-safe)", () => {
	it("offers to a tool-capable model (reasoning is fine — not a reasoning scaffold)", () => {
		expect(decideMcpServerModelFit(BASIC_MEMORY_FIT, capable("instruct")).offer).toBe(true);
		expect(decideMcpServerModelFit(BASIC_MEMORY_FIT, capable("reasoning")).offer).toBe(true);
	});

	it("does NOT require chaining (a single-shot capable model can still read/write notes)", () => {
		expect(decideMcpServerModelFit(BASIC_MEMORY_FIT, capable("instruct", "single_only")).offer).toBe(true);
	});

	it("SKIPS a weak tool-caller (below TOOL_CAPABLE — a weak writer accretes junk into a durable store)", () => {
		expect(decideMcpServerModelFit(BASIC_MEMORY_FIT, entry({ toolUse: "TOOL_WEAK", kind: "instruct" })).offer).toBe(
			false,
		);
	});

	it("SKIPS an uncatalogued model (fail-safe — a memory tool that loops/writes junk is worse than none)", () => {
		expect(decideMcpServerModelFit(BASIC_MEMORY_FIT, null).offer).toBe(false);
		expect(decideMcpServerModelFitById(BASIC_MEMORY_FIT, "no-such-model-xyz-999").offer).toBe(false);
	});
});
