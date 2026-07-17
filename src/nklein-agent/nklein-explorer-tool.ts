/**
 * F11.2j read-only explorer subagent — the tool contracts.
 *
 * FastContext's result: a SMALL explorer that reads/searches in its OWN fresh context and hands the coder only
 * file:line citations cuts main-agent tokens ~60% — reading/searching is ~56% of tool turns, and it does not need
 * to live in the coder's window. Two tools implement that split here, mirroring the plan-critique pattern:
 *
 *  - `explore` (WORKER-side): the coder asks a scoped question; the runner spins a bounded `::explore` session.
 *  - `submit_citations` (EXPLORER-side): the explorer's structured hand-back — citations + one-line notes + a
 *    short answer; prose replies are not the deliverable.
 *
 * The explorer session gets the ordinary read/search tool set (read_files, search_code, ast_search, ego_graph,
 * repo_map) via the normal sandbox tool assembly — this module only owns the contracts, prompt, and rendering.
 */

import { z } from "zod";
import type { AgentTool } from "./sdk-agent-types";

export const nkleinExplorerCitationSchema = z.object({
	path: z.string().min(1),
	/** 1-based line when the citation is that precise; null for whole-file relevance. */
	line: z.number().int().positive().nullable().optional().default(null),
	/** One line: WHY this location matters for the question. */
	note: z.string().min(1),
});

export const nkleinExplorerSubmissionSchema = z.object({
	/** A short direct answer to the question (a few sentences — the citations carry the detail). */
	answer: z.string().min(1),
	citations: z.array(nkleinExplorerCitationSchema).min(1).max(12),
});

export interface NKleinExplorerResult {
	answer: string;
	citations: Array<{ path: string; line: number | null; note: string }>;
}

export type NKleinExplorerCitationsSubmittedHandler = (result: NKleinExplorerResult) => void | Promise<void>;

/** WORKER-side handler the runner supplies: run one bounded explorer session for a question; null on any failure. */
export type NKleinExplorerQueryHandler = (question: string) => Promise<NKleinExplorerResult | null>;

export function createNKleinExplorerCitationsTool(options: {
	onSubmitted?: NKleinExplorerCitationsSubmittedHandler;
}): AgentTool {
	return {
		name: "submit_citations",
		description:
			"Submit your exploration findings. Call this exactly once with a short `answer` and 1–12 `citations` ({path, line, note}) naming exactly WHERE the relevant code lives and why each location matters. Do not answer in prose; the findings are delivered by this tool call.",
		inputSchema: {
			type: "object",
			properties: {
				// Models sometimes echo the tool name inside the arguments — tolerated and ignored (Zod strips it).
				name: { type: ["string", "null"], description: "Ignored. Do not include." },
				answer: { type: "string", description: "A few sentences answering the question directly." },
				citations: {
					type: "array",
					items: {
						type: "object",
						properties: {
							path: { type: "string", description: "Workspace-relative file path." },
							line: { type: ["number", "null"], description: "1-based line, or null for whole-file relevance." },
							note: { type: "string", description: "One line: why this location matters." },
						},
						required: ["path", "note"],
					},
					description: "1–12 read targets, most relevant first.",
				},
			},
			required: ["answer", "citations"],
		},
		async execute(input) {
			const parsed = nkleinExplorerSubmissionSchema.safeParse(input);
			if (!parsed.success) {
				return {
					error: "Could not read the findings. Call submit_citations with a non-empty `answer` and 1–12 `citations` of {path, line, note}.",
				};
			}
			await options.onSubmitted?.({
				answer: parsed.data.answer,
				citations: parsed.data.citations.map((citation) => ({
					path: citation.path,
					line: citation.line ?? null,
					note: citation.note,
				})),
			});
			return { ok: true, message: "Findings recorded. You are done — do not continue exploring." };
		},
	};
}

/** The explorer session's seed brief. Read-only by contract; the submit tool is the only deliverable. */
export function buildExplorerSeedPrompt(question: string): string {
	return [
		"You are a READ-ONLY code explorer. Another agent is working a task and needs targeted context from this repository — your whole job is to find WHERE the relevant code lives, not to change anything.",
		"",
		"## Question",
		question.trim(),
		"",
		"## How to work",
		"- Use repo_map for orientation, ego_graph/ast_search to localize symbols, search_code for text, and read_files with FOCUSED ranges to confirm.",
		"- Do NOT edit files or run write commands — findings only.",
		"- Finish by calling `submit_citations` exactly once: a short direct answer + 1–12 {path, line, note} citations, most relevant first. The citations are the deliverable; keep the answer to a few sentences.",
	].join("\n");
}

/** Render the explorer's findings as the worker-visible tool result — compact, citation-first. */
export function renderExplorerResultForWorker(result: NKleinExplorerResult): string {
	return [
		`Explorer answer: ${result.answer.trim()}`,
		"Read targets (most relevant first):",
		...result.citations.map(
			(citation) => `- ${citation.path}${citation.line ? `:${citation.line}` : ""} — ${citation.note}`,
		),
		"Read only the cited ranges you actually need; the explorer already scanned the rest.",
	].join("\n");
}

/** The WORKER-side `explore` tool: delegate a scoped read/search question to a fresh-context subagent. */
export function createNKleinExploreTool(runQuery: NKleinExplorerQueryHandler): AgentTool {
	return {
		name: "explore",
		description:
			'Delegate a scoped code-reading question to a read-only explorer subagent with a FRESH context window (e.g. "where is task routing decided and what shapes does it consume?"). It searches the repo and returns file:line citations + a short answer, keeping your own context small. Use it BEFORE diving into unfamiliar subsystems; ask one specific question at a time.',
		inputSchema: {
			type: "object",
			properties: {
				question: {
					type: "string",
					description: "One specific question about this codebase (what/where/how — not a change request).",
				},
			},
			required: ["question"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			const question = typeof record.question === "string" ? record.question.trim() : "";
			if (!question) {
				return { error: "explore requires a non-empty `question`." };
			}
			const result = await runQuery(question).catch(() => null);
			if (!result) {
				return {
					error: "The explorer could not complete (budget, capacity, or no findings). Fall back to your own repo_map/search_code/read_files.",
				};
			}
			return { findings: renderExplorerResultForWorker(result) };
		},
	};
}
