/**
 * `nklein dev serialization-cost` — what is FILE-level conflict serialization costing us? (P21.12's decision input.)
 *
 * Reads real boards and classifies every card pair with the SAME `classifyCardPairConflict` production uses — a
 * re-implementation here could disagree with the rule it is meant to measure, and the disagreement would look
 * like a finding.
 */

import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	measureSerializationCost,
	type SerializationCostBoard,
	type SerializationCostCard,
} from "../core/serialization-cost";
import { classifyCardPairConflict } from "../core/task-file-overlap";

export interface DevSerializationCostOptions {
	/** Root to scan for `board.json`; defaults to the runtime home. */
	root?: string;
	json?: boolean;
	/** Injected in tests so no filesystem is touched. */
	loadBoards?: () => readonly SerializationCostBoard[];
}

/** Single-file coding katas — their collisions are a property of the fixture, not of !Klein's scheduling. */
function isBenchmarkFixture(name: string): boolean {
	return /^(aider|swebench|terminal-bench)/u.test(name);
}

function loadBoardsFrom(root: string): SerializationCostBoard[] {
	const boards: SerializationCostBoard[] = [];
	for (const file of globSync(`${root}/**/board.json`)) {
		let parsed: { columns?: { cards?: unknown[] }[] };
		try {
			parsed = JSON.parse(readFileSync(file, "utf8")) as { columns?: { cards?: unknown[] }[] };
		} catch {
			continue;
		}
		const name = file.split("/").slice(-2)[0] ?? file;
		boards.push({
			name,
			isBenchmarkFixture: isBenchmarkFixture(name),
			cards: (parsed.columns ?? []).flatMap((column) => (column.cards ?? []) as SerializationCostCard[]),
		});
	}
	return boards;
}

export function runDevSerializationCostCommand(options: DevSerializationCostOptions = {}): void {
	const boards = options.loadBoards
		? options.loadBoards()
		: loadBoardsFrom(options.root ?? join(homedir(), ".nklein"));
	const report = measureSerializationCost({
		boards,
		classify: (left, right) => classifyCardPairConflict(left as never, right as never),
	});

	if (options.json) {
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		return;
	}
	const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
	process.stdout.write(`${report.summary}\n\n`);
	process.stdout.write(
		`  real projects        ${report.realWork.boards} board(s)  ${report.realWork.serialized}/${report.realWork.pairs} pairs  ${pct(report.realWork.rate)}\n`,
	);
	process.stdout.write(
		`  benchmark fixtures   ${report.benchmarkFixtures.boards} board(s)  ${report.benchmarkFixtures.serialized}/${report.benchmarkFixtures.pairs} pairs  ${pct(report.benchmarkFixtures.rate)}\n`,
	);
	// Printed so a zero can never be mistaken for "the classifier ran and found nothing".
	process.stdout.write(
		`  class split          ${Object.entries(report.classCounts)
			.map(([name, count]) => `${name}=${count}`)
			.join("  ")}\n`,
	);
	if (report.topPaths.length > 0) {
		process.stdout.write("\ntop serializing paths:\n");
		for (const entry of report.topPaths) {
			process.stdout.write(`  ${String(entry.pairs).padStart(4)} pairs  ${entry.path}\n`);
		}
	}
}
