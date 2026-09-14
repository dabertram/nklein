/**
 * !Klein's OWN project board (David 2026-09-05: "create a project for nklein itself … make the dag reflect
 * everything that was already done in reasonable work packages which are set to finished … this project shall be
 * part of git and get updated with each git commit … a soft switch").
 *
 * Mirrors the repo's plan documents into the repo's own !Klein board:
 *   - every `## …` section of done.md          → a COMPLETED work-package card, chained in document order (the
 *                                                 historical spine, so the DAG reads left→right as the project grew);
 *   - every open `- [ ] **ID — title**` in todo.md §5 → a PLANNING card that depends on the newest done package
 *                                                 (open work hangs off the current state), moved to COMPLETED the
 *                                                 moment todo.md stops listing it as open;
 *   - the git log                               → commits mentioning an item id are appended to that card's prompt
 *                                                 ("Commits:"), unmatched recent commits land on one rolling card.
 * Idempotent (stable card ids: `done:<slug>`, `todo:<id>`, `commits:unfiled`) and fast enough for the pre-commit hook,
 * which then stages `.nklein/nklein/workspace/board-crdt.json` — the committed, portable board (specsheet §14.2).
 * Titles are never truncated (David 2026-09-05).
 */
import type { RuntimeTaskTestability } from "../src/core/board-api-contract";
import { applyDeclaredTodoDependencies } from "../src/core/todo-card-dependencies";
import { selfBoardCardStartDefaults } from "../src/core/self-board-card-defaults";
import { deriveTodoCardTestability } from "../src/core/todo-card-testability";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeBoardCard, RuntimeBoardData } from "../src/core/api-contract";
import { addTaskToColumn, moveTaskToColumn } from "../src/core/task-board-mutations";
import { exportLocalBoardToPortableCrdt, resolveMachineReplicaId } from "../src/state/portable-board-store";
import { mutateWorkspaceState } from "../src/state/workspace-state";

const repoPath = resolve(process.argv.find((arg) => arg.startsWith("--repo="))?.slice("--repo=".length) ?? process.cwd());
const quiet = process.argv.includes("--quiet");
const log = (message: string): void => {
	if (!quiet) {
		console.log(message);
	}
};

const PROMPT_BUDGET_CHARS = 2_400;
const ITEM_ID_PATTERN = /\b(P\d+\.[A-Z0-9-]+[a-z]?|F\d+\.\d+[a-z]?|N\d+|§\d+\.[A-Z]+)\b/gu;

interface DonePackage {
	id: string;
	title: string;
	prompt: string;
}
interface OpenItem {
	id: string;
	itemId: string;
	title: string;
	prompt: string;
	/** The entry's full, unclamped text — a `*(depends on: …)*` declaration may sit past the prompt budget. */
	text: string;
}

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, 80);
}

function parseDone(markdown: string): DonePackage[] {
	const packages: DonePackage[] = [];
	let current: { title: string; lines: string[] } | null = null;
	for (const line of markdown.split("\n")) {
		if (line.startsWith("## ")) {
			if (current) {
				packages.push(finishDone(current));
			}
			current = { title: line.slice(3).trim(), lines: [] };
		} else if (current) {
			current.lines.push(line);
		}
	}
	if (current) {
		packages.push(finishDone(current));
	}
	return packages;
}

function finishDone(section: { title: string; lines: string[] }): DonePackage {
	const items = section.lines.filter((line) => /^- \[x\]/u.test(line));
	const body = items.map((line) => line.replace(/^- \[x\]\s*/u, "- ")).join("\n");
	const prompt = `${items.length} shipped item(s) — from done.md, section "${section.title}".\n\n${clampPrompt(body)}`;
	return { id: `done:${slug(section.title)}`, title: section.title, prompt };
}

function parseOpen(markdown: string): OpenItem[] {
	const start = markdown.indexOf("\n## 5.");
	const backlog = start >= 0 ? markdown.slice(start) : markdown;
	const lines = backlog.split("\n");
	const items: OpenItem[] = [];
	let current: { itemId: string; title: string; lines: string[] } | null = null;
	const flush = (): void => {
		if (!current) {
			return;
		}
		items.push({
			id: `todo:${current.itemId}`,
			itemId: current.itemId,
			title: `${current.itemId} — ${current.title}`,
			prompt: `Open backlog item ${current.itemId} (todo.md §5).\n\n${clampPrompt(current.lines.join("\n").trim())}`,
			text: current.lines.join("\n"),
		});
		current = null;
	};
	for (const line of lines) {
		const open = line.match(/^- \[ \] \*\*([A-Za-z0-9§.-]+)\s+—\s+(.*)$/u);
		if (open) {
			flush();
			const rest = open[2] ?? "";
			const titleEnd = rest.indexOf("**");
			current = { itemId: open[1] ?? "item", title: (titleEnd >= 0 ? rest.slice(0, titleEnd) : rest).trim(), lines: [line] };
			continue;
		}
		if (current && (/^- \[[ x]\] /u.test(line) || line.startsWith("## "))) {
			flush();
			continue;
		}
		current?.lines.push(line);
	}
	flush();
	return items;
}

function clampPrompt(text: string): string {
	return text.length > PROMPT_BUDGET_CHARS ? `${text.slice(0, PROMPT_BUDGET_CHARS)}\n… (see the source file for the rest)` : text;
}

function gitLog(): { sha: string; subject: string }[] {
	try {
		const out = execFileSync("git", ["-C", repoPath, "log", "--format=%h%x09%s", "-n", "600"], { encoding: "utf8" });
		return out
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [sha = "", ...rest] = line.split("\t");
				return { sha, subject: rest.join("\t") };
			});
	} catch {
		return [];
	}
}

function currentBranch(): string {
	try {
		return execFileSync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim() || "HEAD";
	} catch {
		return "HEAD";
	}
}

function findCard(board: RuntimeBoardData, id: string): { card: RuntimeBoardCard; columnId: string } | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === id);
		if (card) {
			return { card, columnId: column.id };
		}
	}
	return null;
}

function upsertCard(
	board: RuntimeBoardData,
	input: {
		id: string;
		title: string;
		prompt: string;
		columnId: "planning" | "completed";
		baseRef: string;
		testability?: RuntimeTaskTestability;
		reason?: string;
	},
	now: number,
): RuntimeBoardData {
	const existing = findCard(board, input.id);
	// F2.36 (d): a todo card starts in PLAN mode (a backlog entry is a work package the architect splits first);
	// a done package never starts. Re-derived on every sync like testability, so the existing backlog is shaped too.
	const startDefaults = selfBoardCardStartDefaults(input.columnId === "planning" ? "todo" : "done");
	if (!existing) {
		const created = addTaskToColumn(
			board,
			input.columnId,
			{
				taskId: input.id,
				title: input.title,
				prompt: input.prompt,
				...startDefaults,
				baseRef: input.baseRef,
				...(input.testability ? { testability: input.testability } : {}),
				...(input.reason ? { testabilityReason: input.reason } : {}),
			} as never,
			() => input.id,
			now,
		);
		return created.board;
	}
	let next: RuntimeBoardData = {
		...board,
		columns: board.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => {
				if (card.id !== input.id) {
					return card;
				}
				// Testability is re-derived on every sync, not only at creation: an entry that gains or loses its
				// `*(not testable: …)*` declaration must move the card with it. A sizing that only applies to cards
				// created after the feature landed would leave the whole existing backlog permanently unsized.
				const nextTestability = input.testability ?? "testable";
				const nextReason = input.reason ?? "";
				const unchanged =
					card.title === input.title &&
					card.prompt === input.prompt &&
					(card.testability ?? "testable") === nextTestability &&
					(card.testabilityReason ?? "") === nextReason &&
					(card.startInPlanMode ?? false) === startDefaults.startInPlanMode;
				if (unchanged) {
					return card;
				}
				return {
					...card,
					title: input.title,
					prompt: input.prompt,
					testability: nextTestability,
					testabilityReason: nextReason,
					startInPlanMode: startDefaults.startInPlanMode,
					updatedAt: now,
				};
			}),
		})),
	};
	if (existing.columnId !== input.columnId && input.columnId === "completed") {
		next = moveTaskToColumn(next, input.id, "completed").board;
	}
	return next;
}

function ensureDependency(board: RuntimeBoardData, dependent: string, prerequisite: string, now: number): RuntimeBoardData {
	if (dependent === prerequisite) {
		return board;
	}
	const exists = board.dependencies.some((edge) => edge.fromTaskId === dependent && edge.toTaskId === prerequisite);
	if (exists) {
		return board;
	}
	return {
		...board,
		dependencies: [...board.dependencies, { id: `self:${dependent}->${prerequisite}`, fromTaskId: dependent, toTaskId: prerequisite, createdAt: now }],
	};
}

async function main(): Promise<void> {
	const now = Date.now();
	const baseRef = currentBranch();
	const doneMarkdown = readFileSync(resolve(repoPath, "done.md"), "utf8");
	const done = parseDone(doneMarkdown);
	const open = parseOpen(readFileSync(resolve(repoPath, "todo.md"), "utf8"));
	const commits = gitLog();
	const commitsByItem = new Map<string, { sha: string; subject: string }[]>();
	const unfiled: { sha: string; subject: string }[] = [];
	for (const commit of commits) {
		const ids = new Set([...commit.subject.matchAll(ITEM_ID_PATTERN)].map((match) => match[1] ?? ""));
		if (ids.size === 0) {
			unfiled.push(commit);
			continue;
		}
		for (const id of ids) {
			const list = commitsByItem.get(id) ?? [];
			list.push(commit);
			commitsByItem.set(id, list);
		}
	}
	const openIds = new Set(open.map((item) => item.id));
	let created = 0;
	let completed = 0;
	await mutateWorkspaceState(repoPath, (state) => {
		let board = state.board;
		const before = new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
		let previousDone: string | null = null;
		for (const pkg of done) {
			board = upsertCard(board, { ...pkg, columnId: "completed", baseRef }, now);
			if (previousDone) {
				board = ensureDependency(board, pkg.id, previousDone, now);
			}
			previousDone = pkg.id;
		}
		const spineHead = previousDone;
		for (const item of open) {
			const refs = commitsByItem.get(item.itemId) ?? [];
			const prompt =
				refs.length > 0
					? `${item.prompt}\n\nCommits (newest first):\n${refs.slice(0, 12).map((commit) => `- ${commit.sha} ${commit.subject}`).join("\n")}`
					: item.prompt;
			// F2.36 (c): size the card from its own todo text, so !Klein does not put a decision note or an
			// operator-blocked entry through the test-driven gate. Default is testable; an exemption is earned.
			const testability = deriveTodoCardTestability(`${item.title}\n${item.prompt}`);
			board = upsertCard(
				board,
				{ id: item.id, title: item.title, prompt, columnId: "planning", baseRef, ...testability },
				now,
			);
		}
		// F2.36 (b): dependencies BETWEEN open items come only from an explicit `*(depends on: ID, ID)*` in the
		// entry — a mention is not a dependency (P25.3 and P23.5 cite each other; edges inferred from references
		// cycle on the first pass, and a wrong edge BLOCKS work). Every declaration passes the board's cycle guard;
		// a refused, unknown or already-shipped one is SAID here, never silently dropped. A card with a declared
		// prerequisite hangs off it instead of the spine head; everything else keeps hanging off the spine.
		const declared = applyDeclaredTodoDependencies({
			board,
			items: open.map((item) => ({ cardId: item.id, itemId: item.itemId, text: item.text })),
			isShipped: (itemId) =>
				new RegExp(`\\*\\*${itemId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(doneMarkdown),
			nowMs: now,
		});
		board = declared.board;
		for (const edge of declared.added) {
			log(`self-board: declared dependency ${edge.dependent} -> ${edge.prerequisite}`);
		}
		for (const edge of declared.removed) {
			log(`self-board: declaration withdrawn, edge removed ${edge.dependent} -> ${edge.prerequisite}`);
		}
		for (const refusal of declared.refused) {
			log(`self-board: REFUSED declared dependency ${refusal.dependent} -> ${refusal.declared} (${refusal.reason})`);
		}
		for (const done of declared.satisfied) {
			log(`self-board: ${done.dependent} depends on ${done.declared}, which shipped — satisfied, no edge`);
		}
		for (const item of open) {
			if (!spineHead) {
				continue;
			}
			if (declared.dependentsWithEdges.has(item.id)) {
				board = {
					...board,
					dependencies: board.dependencies.filter((edge) => edge.id !== `self:${item.id}->${spineHead}`),
				};
			} else {
				board = ensureDependency(board, item.id, spineHead, now);
			}
		}
		// Open items that vanished from todo.md were shipped (they move to done.md) — complete their cards.
		for (const column of board.columns) {
			if (column.id === "completed") {
				continue;
			}
			for (const card of column.cards) {
				if (card.id.startsWith("todo:") && !openIds.has(card.id)) {
					board = moveTaskToColumn(board, card.id, "completed").board;
					completed += 1;
				}
			}
		}
		if (unfiled.length > 0) {
			board = upsertCard(
				board,
				{
					id: "commits:unfiled",
					title: "Recent commits not tied to a backlog id",
					prompt: `Commits whose subject names no todo/done item id (newest first, last 40 of ${unfiled.length}):\n${unfiled.slice(0, 40).map((commit) => `- ${commit.sha} ${commit.subject}`).join("\n")}`,
					columnId: "completed",
					baseRef,
				},
				now,
			);
			if (spineHead) {
				board = ensureDependency(board, "commits:unfiled", spineHead, now);
			}
		}
		const after = new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
		created = [...after].filter((id) => !before.has(id)).length;
		return { board, save: true, value: null };
	});
	const state = await mutateWorkspaceState(repoPath, (current) => ({ board: current.board, save: false, value: current.board }));
	const board = (state as { value?: RuntimeBoardData }).value ?? null;
	if (board) {
		const replicaId = await resolveMachineReplicaId();
		const exported = await exportLocalBoardToPortableCrdt({ repoPath, board, replicaId });
		log(`self-board: ${done.length} done package(s), ${open.length} open item(s), ${commits.length} commit(s) scanned; ${created} card(s) created, ${completed} completed; portable board → ${exported.path}`);
	}
}

main().catch((error: unknown) => {
	console.error(`self-board-sync failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
