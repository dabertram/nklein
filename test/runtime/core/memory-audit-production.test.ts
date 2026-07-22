import { describe, expect, it } from "vitest";
import type { AgentLedgerEvent } from "../../../src/core/agent-attempt-ledger";
import {
	applyMemoryAuditMetadata,
	type MemoryAuditFileDeps,
	memoryAuditModelAnalysisSchema,
	memoryAuditSourceHash,
	readMemoryAuditCandidates,
	reconcileMemoryAuditSignals,
	stampMemoryWriteProvenance,
} from "../../../src/core/memory-audit-production";

function fakeFs(initial: Record<string, string>): { deps: MemoryAuditFileDeps; files: Map<string, string> } {
	const files = new Map(Object.entries(initial));
	const deps: MemoryAuditFileDeps = {
		listMarkdownFiles: async (root) =>
			[...files.keys()].filter((path) => path.startsWith(`${root}/`) && path.endsWith(".md")),
		readFile: async (path) => {
			const value = files.get(path);
			if (value === undefined) throw new Error("missing");
			return value;
		},
		statMtimeMs: async () => 123,
		writeFile: async (path, content) => {
			files.set(path, content);
		},
		rename: async (from, to) => {
			const value = files.get(from);
			if (value === undefined) throw new Error("missing temp");
			files.delete(from);
			files.set(to, value);
		},
	};
	return { deps, files };
}

function attempt(taskId: string, outcome: "success" | "other_failure", recordedAt = 1): AgentLedgerEvent {
	return { kind: "attempt", taskId, outcome, recordedAt } as AgentLedgerEvent;
}

describe("memory audit production metadata", () => {
	it("merges trusted write provenance into existing frontmatter and clears stale audit fields", () => {
		const stamped = stampMemoryWriteProvenance("---\ntitle: Demo\naudit_verdict: confirmed\n---\n# Body", {
			authorModelKey: "model-b",
			taskId: "card-2",
			createdAtIso: "2026-07-22T12:00:00.000Z",
		});
		expect(stamped.match(/^---$/gm)).toHaveLength(2);
		expect(stamped).toContain('authored_by: "model-b"');
		expect(stamped).toContain('task_id: "card-2"');
		expect(stamped).toContain("audit_verdict: null");
		expect(stamped).toContain("title: Demo");
	});

	it("keeps the source hash stable across audit metadata and changes it when prose changes", () => {
		const note = "---\ntitle: Demo\n---\n# Body\nA fact.";
		const hash = memoryAuditSourceHash(note);
		const audited = applyMemoryAuditMetadata(note, {
			verdict: "confirmed",
			auditedAtIso: "2026-07-22T12:00:00.000Z",
			sourceHash: hash,
			auditorModelKey: "model-c",
			reason: "checked",
		});
		expect(memoryAuditSourceHash(audited)).toBe(hash);
		expect(memoryAuditSourceHash(`${audited}\nChanged.`)).not.toBe(hash);
	});

	it("returns only unaudited/content-changed notes and carries the author", async () => {
		const fresh = stampMemoryWriteProvenance("# Fresh", {
			authorModelKey: "author",
			taskId: "t",
			createdAtIso: "2026-07-22T12:00:00.000Z",
		});
		const doneHash = memoryAuditSourceHash(fresh);
		const done = applyMemoryAuditMetadata(fresh, {
			verdict: "confirmed",
			auditedAtIso: "2026-07-22T12:01:00.000Z",
			sourceHash: doneHash,
			auditorModelKey: "auditor",
			reason: "checked",
		});
		const { deps } = fakeFs({ "/bm/open.md": fresh, "/bm/done.md": done });
		const candidates = await readMemoryAuditCandidates([{ scope: "project", rootDir: "/bm" }], deps);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({ authorModelKey: "author", scope: "project" });
		expect(candidates[0]?.ref).toMatch(/^project:open@/);
	});
});

describe("reconcileMemoryAuditSignals", () => {
	it("uses only grounded claims and distinguishes confirmations, contradictions, and unavailable graph evidence", async () => {
		const body = "Function realFn exists in src/a.ts. Task card-ok succeeded. A is enabled. A is disabled.";
		const analysis = memoryAuditModelAnalysisSchema.parse({
			structuralClaims: [
				{ symbol: "realFn", file: "src/a.ts", quote: "Function realFn exists in src/a.ts." },
				{ symbol: "ghost", file: null, quote: "invented quote" },
			],
			ledgerClaims: [
				{ taskId: "card-ok", claimedOutcome: "success", quote: "Task card-ok succeeded." },
				{ taskId: "card-bad", claimedOutcome: "success", quote: "invented quote" },
			],
			internalContradictions: [
				{ leftQuote: "A is enabled.", rightQuote: "A is disabled.", reason: "A has opposite states" },
			],
		});
		const signals = await reconcileMemoryAuditSignals({
			body,
			analysis,
			ledgerEvents: [attempt("card-ok", "success"), attempt("card-bad", "other_failure")],
			resolveStructuralClaim: async (claim) => (claim.symbol === "realFn" ? "resolved" : "unavailable"),
		});
		expect(signals).toEqual({
			resolvedSymbols: ["realFn"],
			unresolvedSymbols: [],
			ledgerConfirmations: ["card-ok: note says success, ledger says success"],
			ledgerContradictions: [],
			internalContradictions: ["A has opposite states"],
		});
	});

	it("compares a final outcome claim with the latest attempt", async () => {
		const signals = await reconcileMemoryAuditSignals({
			body: "Task x failed.",
			analysis: {
				structuralClaims: [],
				ledgerClaims: [{ taskId: "x", claimedOutcome: "failure", quote: "Task x failed." }],
				internalContradictions: [],
			},
			ledgerEvents: [attempt("x", "other_failure", 1), attempt("x", "success", 2)],
			resolveStructuralClaim: async () => "unavailable",
		});
		expect(signals.ledgerContradictions).toEqual(["x: note says failure, ledger says success"]);
	});
});
