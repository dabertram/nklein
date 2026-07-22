/**
 * F4.32 — production effects around the pure memory-audit verdict core.
 *
 * A strong model is used only to EXTRACT bounded, quoted claims from authored prose. Whether a structural claim exists
 * and whether an outcome claim agrees with history are decided by the code graph and typed attempt ledger. Audit
 * metadata is content-hash keyed: changing a note invalidates its old verdict even if a hand edit leaves the old
 * frontmatter behind. Markdown remains the source of truth and writes are compare-before-atomic-replace.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { z } from "zod";
import type { AgentLedgerEvent } from "./agent-attempt-ledger.js";
import {
	auditMemoryNote,
	type MemoryAuditResult,
	type MemoryAuditSignals,
	type MemoryAuditVerdict,
} from "./memory-audit.js";

const AUDIT_FIELDS = new Set(["audit_verdict", "audit_at", "audit_content_sha256", "audit_model", "audit_reason"]);
const AUDIT_VERDICTS = new Set<MemoryAuditVerdict>(["confirmed", "contradicted", "unverifiable"]);
const MAX_CLAIMS = 24;

export const MEMORY_AUDIT_REQUIRED_CONTEXT_TOKENS = 32_768;

const structuralClaimSchema = z
	.object({
		symbol: z.string().trim().min(1).max(240),
		file: z.string().trim().min(1).max(500).nullable(),
		quote: z.string().trim().min(1).max(700),
	})
	.strict();

const ledgerClaimSchema = z
	.object({
		taskId: z.string().trim().min(1).max(240),
		claimedOutcome: z.enum(["success", "failure"]),
		quote: z.string().trim().min(1).max(700),
	})
	.strict();

const internalContradictionSchema = z
	.object({
		leftQuote: z.string().trim().min(1).max(700),
		rightQuote: z.string().trim().min(1).max(700),
		reason: z.string().trim().min(1).max(500),
	})
	.strict();

export const memoryAuditModelAnalysisSchema = z
	.object({
		structuralClaims: z.array(structuralClaimSchema).max(MAX_CLAIMS),
		ledgerClaims: z.array(ledgerClaimSchema).max(MAX_CLAIMS),
		internalContradictions: z.array(internalContradictionSchema).max(MAX_CLAIMS),
	})
	.strict();

export type MemoryAuditModelAnalysis = z.infer<typeof memoryAuditModelAnalysisSchema>;

export interface MemoryAuditRoot {
	scope: "project" | "global";
	rootDir: string;
}

export interface MemoryAuditCandidate {
	ref: string;
	scope: MemoryAuditRoot["scope"];
	filePath: string;
	title: string;
	body: string;
	updatedAt: number;
	authorModelKey: string | null;
	sourceHash: string;
}

interface FrontmatterSplit {
	frontmatter: string[] | null;
	body: string;
}

export interface MemoryAuditFileDeps {
	listMarkdownFiles(rootDir: string): Promise<string[]>;
	readFile(path: string): Promise<string>;
	statMtimeMs(path: string): Promise<number>;
	writeFile(path: string, content: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

function splitFrontmatter(content: string): FrontmatterSplit {
	const normalized = content.replaceAll("\r\n", "\n");
	if (!normalized.startsWith("---\n")) return { frontmatter: null, body: normalized };
	const lines = normalized.split("\n");
	const close = lines.indexOf("---", 1);
	if (close < 0) return { frontmatter: null, body: normalized };
	return { frontmatter: lines.slice(1, close), body: lines.slice(close + 1).join("\n") };
}

function scalarLineKey(line: string): string | null {
	const match = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/u);
	return match?.[1] ?? null;
}

function parseScalar(raw: string): string | null {
	const value = raw.trim();
	if (!value || value === "null" || value === "~") return null;
	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			const parsed = JSON.parse(value) as unknown;
			return typeof parsed === "string" ? parsed : null;
		} catch {
			return value.slice(1, -1);
		}
	}
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
	return value;
}

function readScalar(lines: readonly string[] | null, key: string): string | null {
	if (!lines) return null;
	for (const line of lines) {
		if (scalarLineKey(line) === key) return parseScalar(line.slice(line.indexOf(":") + 1));
	}
	return null;
}

function yamlScalar(value: string | null): string {
	return value === null ? "null" : JSON.stringify(value);
}

function upsertScalars(content: string, values: Readonly<Record<string, string | null>>): string {
	const split = splitFrontmatter(content);
	const existing = split.frontmatter ?? [];
	const keys = new Set(Object.keys(values));
	const retained = existing.filter((line) => {
		const key = scalarLineKey(line);
		return key === null || !keys.has(key);
	});
	const additions = Object.entries(values).map(([key, value]) => `${key}: ${yamlScalar(value)}`);
	return ["---", ...retained, ...additions, "---", split.body].join("\n");
}

/** Content identity excluding audit-owned metadata, so persisting a verdict does not invalidate itself. */
export function memoryAuditSourceHash(content: string): string {
	const split = splitFrontmatter(content);
	const canonical = split.frontmatter
		? [
				"---",
				...split.frontmatter.filter((line) => {
					const key = scalarLineKey(line);
					return key === null || !AUDIT_FIELDS.has(key);
				}),
				"---",
				split.body,
			].join("\n")
		: split.body;
	return createHash("sha256").update(canonical).digest("hex");
}

/** Stamp authorship at the MCP write boundary, merging into (rather than duplicating) caller frontmatter. */
export function stampMemoryWriteProvenance(
	content: string,
	input: { authorModelKey: string; taskId: string; createdAtIso: string; commitSha?: string | null },
): string {
	return upsertScalars(content, {
		authored_by: input.authorModelKey,
		task_id: input.taskId,
		created_at: input.createdAtIso,
		commit: input.commitSha ?? null,
		audit_verdict: null,
		audit_at: null,
		audit_content_sha256: null,
		audit_model: null,
		audit_reason: null,
	});
}

/** Add/replace the verdict metadata without changing the note body or any Basic Memory-owned frontmatter. */
export function applyMemoryAuditMetadata(
	content: string,
	input: {
		verdict: MemoryAuditVerdict;
		auditedAtIso: string;
		sourceHash: string;
		auditorModelKey: string;
		reason: string;
	},
): string {
	return upsertScalars(content, {
		audit_verdict: input.verdict,
		audit_at: input.auditedAtIso,
		audit_content_sha256: input.sourceHash,
		audit_model: input.auditorModelKey,
		audit_reason: input.reason.slice(0, 500),
	});
}

export function nodeMemoryAuditFileDeps(): MemoryAuditFileDeps {
	return {
		async listMarkdownFiles(rootDir) {
			const files: string[] = [];
			const walk = async (dir: string): Promise<void> => {
				let entries: Dirent<string>[];
				try {
					entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
				} catch {
					return;
				}
				for (const entry of entries) {
					if (entry.name.startsWith(".")) continue;
					const path = join(dir, entry.name);
					if (entry.isDirectory()) await walk(path);
					else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(path);
				}
			};
			await walk(rootDir);
			return files;
		},
		readFile: (path) => readFile(path, "utf8"),
		statMtimeMs: async (path) => (await stat(path)).mtimeMs,
		writeFile: (path, content) => writeFile(path, content, { encoding: "utf8", mode: 0o600 }),
		rename,
	};
}

function relativeRef(root: MemoryAuditRoot, path: string): string | null {
	const rel = relative(root.rootDir, path);
	if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) return null;
	return rel.split(sep).join("/");
}

/** Find every unaudited or content-changed note, newest first. */
export async function readMemoryAuditCandidates(
	roots: readonly MemoryAuditRoot[],
	deps: MemoryAuditFileDeps = nodeMemoryAuditFileDeps(),
): Promise<MemoryAuditCandidate[]> {
	const candidates: MemoryAuditCandidate[] = [];
	for (const root of roots) {
		for (const filePath of await deps.listMarkdownFiles(root.rootDir)) {
			const rel = relativeRef(root, filePath);
			if (!rel) continue;
			try {
				const [content, updatedAt] = await Promise.all([deps.readFile(filePath), deps.statMtimeMs(filePath)]);
				const split = splitFrontmatter(content);
				const sourceHash = memoryAuditSourceHash(content);
				const storedHash = readScalar(split.frontmatter, "audit_content_sha256");
				const storedVerdict = readScalar(split.frontmatter, "audit_verdict");
				if (storedHash === sourceHash && storedVerdict && AUDIT_VERDICTS.has(storedVerdict as MemoryAuditVerdict)) {
					continue;
				}
				const permalink = readScalar(split.frontmatter, "permalink") ?? rel.replace(/\.md$/iu, "");
				const heading = split.body.match(/^#{1,6}\s+(.+?)\s*$/mu)?.[1]?.trim();
				candidates.push({
					ref: `${root.scope}:${permalink}@${sourceHash.slice(0, 12)}`,
					scope: root.scope,
					filePath,
					title: readScalar(split.frontmatter, "title") ?? heading ?? permalink,
					body: split.body,
					updatedAt,
					authorModelKey: readScalar(split.frontmatter, "authored_by"),
					sourceHash,
				});
			} catch {
				// One transiently unreadable note must not stop the idle sweep.
			}
		}
	}
	return candidates.sort((left, right) => right.updatedAt - left.updatedAt || left.ref.localeCompare(right.ref));
}

/** Compare-before-write prevents an audit from blessing stale text that changed during its model turn. */
export async function persistMemoryAuditResult(
	candidate: MemoryAuditCandidate,
	result: MemoryAuditResult,
	input: { auditorModelKey: string; auditedAtIso: string },
	deps: MemoryAuditFileDeps = nodeMemoryAuditFileDeps(),
): Promise<"persisted" | "stale"> {
	const current = await deps.readFile(candidate.filePath);
	if (memoryAuditSourceHash(current) !== candidate.sourceHash) return "stale";
	const next = applyMemoryAuditMetadata(current, {
		verdict: result.verdict,
		auditedAtIso: input.auditedAtIso,
		sourceHash: candidate.sourceHash,
		auditorModelKey: input.auditorModelKey,
		reason: result.reason,
	});
	const temp = join(dirname(candidate.filePath), `.${basename(candidate.filePath)}.${randomUUID()}.tmp`);
	await deps.writeFile(temp, next);
	await deps.rename(temp, candidate.filePath);
	return "persisted";
}

export function buildMemoryAuditPrompt(candidate: Pick<MemoryAuditCandidate, "title" | "body">): string {
	return [
		`Audit the authored memory note titled ${JSON.stringify(candidate.title)}.`,
		"Extract claims only; do not decide the final verdict.",
		"Structural claims must name a concrete code symbol claimed to exist. Include its expected repo-relative file only when the note states one.",
		"Ledger claims must be unqualified final/current claims that a named task succeeded or failed; ignore historical intermediate attempts.",
		"Every claim must carry an exact quote copied from the note. Report an internal contradiction only when two exact quotes cannot both be true.",
		"If none exist, return empty arrays. Never invent a symbol, task id, file, or quote.",
		"\n<untrusted_memory_note>\n",
		candidate.body.slice(0, 80_000),
		"\n</untrusted_memory_note>",
	].join("\n");
}

function quoteIsGrounded(body: string, quote: string): boolean {
	return quote.length > 0 && body.includes(quote);
}

function latestAttemptOutcome(events: readonly AgentLedgerEvent[], taskId: string): "success" | "failure" | null {
	const attempts = events.filter((event) => event.kind === "attempt" && event.taskId === taskId);
	const latest = attempts.sort((left, right) => left.recordedAt - right.recordedAt).at(-1);
	if (latest?.kind !== "attempt") return null;
	return latest.outcome === "success" ? "success" : "failure";
}

export type StructuralClaimResolution = "resolved" | "unresolved" | "unavailable";

/** Reconcile grounded model-extracted claims against authoritative evidence. */
export async function reconcileMemoryAuditSignals(input: {
	body: string;
	analysis: MemoryAuditModelAnalysis;
	ledgerEvents: readonly AgentLedgerEvent[];
	resolveStructuralClaim: (claim: z.infer<typeof structuralClaimSchema>) => Promise<StructuralClaimResolution>;
}): Promise<MemoryAuditSignals> {
	const resolvedSymbols: string[] = [];
	const unresolvedSymbols: string[] = [];
	for (const claim of input.analysis.structuralClaims) {
		if (!quoteIsGrounded(input.body, claim.quote)) continue;
		const resolution = await input.resolveStructuralClaim(claim);
		if (resolution === "resolved") resolvedSymbols.push(claim.symbol);
		else if (resolution === "unresolved") unresolvedSymbols.push(claim.symbol);
	}
	const ledgerConfirmations: string[] = [];
	const ledgerContradictions: string[] = [];
	for (const claim of input.analysis.ledgerClaims) {
		if (!quoteIsGrounded(input.body, claim.quote)) continue;
		const actual = latestAttemptOutcome(input.ledgerEvents, claim.taskId);
		if (actual === null) continue;
		const detail = `${claim.taskId}: note says ${claim.claimedOutcome}, ledger says ${actual}`;
		if (actual === claim.claimedOutcome) ledgerConfirmations.push(detail);
		else ledgerContradictions.push(detail);
	}
	const internalContradictions = input.analysis.internalContradictions
		.filter((claim) => quoteIsGrounded(input.body, claim.leftQuote) && quoteIsGrounded(input.body, claim.rightQuote))
		.map((claim) => claim.reason);
	return { resolvedSymbols, unresolvedSymbols, ledgerConfirmations, ledgerContradictions, internalContradictions };
}

export { auditMemoryNote };
