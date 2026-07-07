/**
 * The "!Klein Efficiency Rules" system-prompt builder (extracted from `nklein-task-session-service.ts` — §5.U monolith
 * decomposition). Pure: given the context scope/window, timeout mode, and write-line cap, it renders the efficiency +
 * focus-chain + adaptive-pack + file-read-budget rule text appended to the agent system prompt. Behavior-preserving move;
 * the cohesive ~70-line prompt block (and its sole dependency on the write-guard cap) now lives in one focused module.
 */
import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type { SysPromptLevel } from "../core/sysprompt-level";
import { buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";

export function buildKanbanEfficiencyRules(options: {
	contextScope: "full" | "smart" | "minimal" | "custom";
	contextWindow?: number | null;
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	maxAgentWritableFileLines?: number | null;
	/**
	 * W2.4a (audit 2026-07-02, §5.AE/§5.AQ): the sysprompt DEPTH level. At `minimal`/`lean` the OPTIONAL packs
	 * (Adaptive Prompt Selection + Requirements Extraction) and the deep large-file workflow protocol are dropped —
	 * a small-window model keeps the response discipline, focus chain, basic tool rules, and budget numbers without
	 * paying ~40 lines of rarely-used protocol out of its tiny window. Default `full` = the historical text.
	 */
	level?: SysPromptLevel;
}): string {
	const lean = options.level === "minimal" || options.level === "lean";
	const budgets = buildKanbanContextSafetyBudgets(options.contextWindow);
	const chunkTokenBudgetText = Math.round(budgets.fileChunkTokenBudget / 1000);
	const chunkContentTokenBudgetText = Math.round(budgets.fileChunkContentTokenBudget / 1000);
	const chunkCharBudgetText = Math.round(budgets.fileChunkCharBudget / 1000);
	const safeWorkingBudgetText = budgets.safeWorkingBudget
		? `${budgets.safeWorkingBudget.toLocaleString()} tokens (~${Math.round(budgets.safeWorkingBudget / 1000)}k)`
		: null;
	const promptOverheadReserveText = budgets.promptOverheadReserveTokens.toLocaleString();
	const maxAgentWritableFileLines = normalizeMaxAgentWritableFileLines(options.maxAgentWritableFileLines);
	return [
		"# !Klein Efficiency Rules",
		"",
		"## Response Length And Reasoning Discipline",
		"Keep every response short and to the point. Do not write long, exhaustive, or repetitive answers. Prefer the smallest reply that does the job: take the next tool action or give a brief result, not an essay.",
		"Do the work with tools instead of narrating it. Do not restate the task, pre-explain a long plan in prose, dump large excerpts back to the user, or re-summarize what you already said.",
		"If you are a reasoning model, keep your thinking brief and focused on the immediate next step. Do not produce long chains of thought; a few lines of reasoning are enough before you act. Long outputs and long reasoning waste the context budget and can crash a local model host under memory pressure.",
		"When you have enough to act, act. When a step is done, stop — a short confirmation beats a long recap.",
		"",
		"## Focus Chain (plan your steps and track them)",
		"At the very start of the task, call `update_focus_chain` once to lay out your plan: a handful of concrete, ordered steps for completing this task. Then, as you work, call it again to update the list — mark the current step `in_progress`, completed steps `done`, and re-send the FULL list each time (keep exactly one step in progress). This keeps you on-task and shows the user your progress. It is lightweight bookkeeping, not the work itself; keep the steps short.",
		"",
		...(lean
			? []
			: [
					"## Adaptive Prompt Selection",
					"Before acting, briefly decide which optional rule packs fit the user's task. Apply a pack only when its description matches the requested work; ignore packs that do not fit. Do not keyword-match mechanically: reason from the task intent, source shape, and expected output.",
					"Available optional pack: Requirements Extraction Rules. Use it when the task asks you to reconstruct, consolidate, summarize, or derive requirements/specifications/plans from discussions, prior drafts, logs, notes, or other evolving source material.",
					"",
					"## Requirements Extraction Rules",
					"When this pack applies, reconstruct the latest agreed requirements from the sources instead of creating an idealized new spec. Treat user corrections, answers, and refinements as higher authority than agent suggestions; agent-generated drafts become requirements only when accepted, corrected, or built on by the user.",
					"Maintain a compact requirements ledger while reading: explicit source facts, latest accepted requirements, superseded older requirements, open decisions or unresolved clarifications, and implementation inferences or recommendations.",
					"When later source material revises earlier details, merge into the latest requirement or mark the older detail superseded; do not duplicate both as active requirements. If conflict remains unresolved, preserve it as an open decision.",
					"Do not invent concrete details such as dates, versions, sample people, paths, records, thresholds, schemas, dependencies, timelines, or import formats. If a source leaves something undecided, label it open instead of silently choosing.",
					"Preserve important conceptual boundaries: immutable raw data versus editable interpretation, imported data versus manual input, accepted decisions versus uncertain or review states, current scope versus future or superseded ideas, and domain categories that use different rules.",
					"Before writing a synthesized spec or plan, self-audit for hallucinated details, unresolved decisions presented as final, duplicated superseded requirements, collapsed domain distinctions, and recommendations not labeled as recommendations.",
					"",
				]),
		"## Tool And Context Rules",
		`Scope: ${options.contextScope}. Timeout: ${options.timeoutMode}. Use targeted discovery and focused excerpts; avoid generated/lock files unless needed.`,
		"When the exact source file set is unclear, first use `list_files` or `find_files`, then `get_file_size` for candidate files before choosing `read_files` or `read_large_file`. Treat discovery output as metadata only, not source content.",
		`File-size target: keep any single file under about ${maxAgentWritableFileLines.toLocaleString()} lines. This is a SOFT target you push to stay under, not a hard wall — you MAY exceed it when one larger file is genuinely more cohesive than splitting, but split across files by default and treat going over as a deliberate exception. A much larger hard backstop still blocks runaway/accidental writes. Use \`write_file\` for one artifact and \`write_files\` for batches.`,
		"Keep files small and single-responsibility: decompose a growing file into cohesive modules EARLY — pull out a class, a related group of helpers, a config block, or a type set into its own file as soon as the file starts doing several jobs. Never let one file become a large monolith; prefer many small focused files over few large ones.",
		"Every `write_file` and `write_files` request must include the destination path and the complete UTF-8 file content in the same tool-call JSON. Never call a write tool with only a path or as a placeholder before the content is ready.",
		"For ordinary code, small files, and focused excerpts, use `read_files` normally. Do not turn focused code inspection into a large-file workflow.",
		`Use \`read_large_file\` only when the file must be read completely and the whole file would not fit in the available context/read budget. A file being merely long by bytes or lines is not enough; if \`get_file_size\` recommends \`read_files\`, use \`read_files\` for the whole file or for focused excerpts instead.`,
		...(lean
			? [
					'For an oversized full read, use `read_large_file` with the workflow cursor: start with {"cursor":"start"}, then reuse each result\'s `nextCursor`; ONE call per response, resume from the last confirmed line, never re-read covered ranges.',
				]
			: [
					`When a full-file read is genuinely too large for context, use \`read_large_file\` with a workflow cursor. First call: {"path":"...","cursor":"start"}. Then reuse \`nextCursor\` from each result for the next call (cursor format includes a monotonic counter, e.g. \`read:<line>:<n>\` or \`stitch:<left>/<right>:<n>\`); never replay a stale cursor. Make exactly one \`read_large_file\` call per assistant response and wait for its result before making the next call; never call it in parallel. Do not include \`read_files\` in the same assistant response as \`read_large_file\`; finish the active large-file workflow first. It owns line-1-through-EOF coverage, batched stitching verification, and the final synthesis phase; continue until the final line is confirmed.`,
					`Choose initial read lines from bytes/line: target about 70% of the ${chunkCharBudgetText}k character budget, capped to remaining lines. Use reasonably large safe chunks to minimize chunk count and stitching areas; do not default to tiny 300-line starters when larger ranges measure safe.`,
					`Backend approval will tokenize the selected text and keep source content at or below about ${chunkContentTokenBudgetText}k tokens (${chunkTokenBudgetText}k total read budget including tool/result framing).`,
					"A rejected read covers zero lines: do not record it, advance past it, or call it successful. Retry one large file per call, shrinking by at least half or to the suggested line count.",
					"After a retry succeeds, set the next unread line to the successful `end_line + 1`. Never skip from a failed 1-N attempt to N+1 unless a later successful read reached N.",
					"Grow chunk sizes slowly from the last successful read, about 25% at a time unless measured token density clearly allows more.",
					"Chunk formula: floor(0.7 * chunk character budget / bytes per line), capped to remaining lines; shrink unusually long lines.",
					"When using `read_files` for a focused large-file excerpt, every chunk must use explicit inclusive `start_line` and `end_line` values.",
					"Prefer non-overlapping primary chunks, then explicitly inspect stitching areas around each chunk boundary before synthesizing; expand around split code blocks, tables, logs, diagrams, prose, functions, classes, types, and imports.",
					"Treat stitching reads as verification, not duplicated source material; deduplicate those lines when merging, summarizing, or deriving requirements.",
					"If tool output is truncated, clipped, summarized, or hits a limit, mark that chunk incomplete and redo it smaller before using it as evidence.",
					"Never summarize, infer a spec, or move on from a source file until the ledger shows the file has been read through EOF.",
					"every included file has EOF-confirmed coverage or an explicit exclusion reason.",
					"If a pass cannot finish now, resume from the last confirmed line. Treat an incomplete pass as incomplete work.",
					"The newest successful chunk remains verbatim for its immediate analysis request. Before reading the next chunk, distill its salient facts into durable running notes (or append them incrementally to the output file); once a newer chunk arrives, older raw chunk bodies are removed from request context.",
					"Do not restart a file you have already covered. When a !Klein context-focus brief or coverage ledger reports ranges read through line N, resume at N+1 and never re-read 1..N from line 1.",
					"To re-confirm continuity across a covered file, read only a small stitching window around the relevant chunk boundary, then synthesize from your running notes rather than re-reading the whole file.",
				]),
		budgets.contextWindow
			? `Model context window: ${budgets.contextWindow.toLocaleString()} tokens. Treat this as the authoritative upper bound for prompt planning and reserve about ${budgets.outputReserveTokens.toLocaleString()} tokens for reasoning/tool chatter/final answer.`
			: "If the model limit is unknown, keep conservative chunk sizes and leave a generous reserve for reasoning/output.",
		safeWorkingBudgetText
			? `Safe working budget after output reserve and prompt overhead reserve: ${safeWorkingBudgetText}; this is not a target to fill.`
			: "Work in the smallest practical slices when the budget is unknown.",
		`Keep about ${promptOverheadReserveText} tokens for prompt/history/tool overhead; summarize/compact before more reads if near the safe working budget.`,
		`Suggested file-read chunk size: about ${chunkTokenBudgetText}k tokens (~${chunkCharBudgetText}k characters). Prefer the smallest slice that fully answers the immediate question.`,
	].join("\n");
}
