/**
 * Completed-without-merge probe (run 20260818-195608). Replays the delivery merge call —
 * mergeTaskWorktreesInDependencyOrder with the same shapes the runtime-server delivery suffix passes —
 * against a CLONE of the preserved dev-test repo, and prints the full step list. If the helper reports
 * ok:true with a `skipped` step, that skip reason IS the completed-without-merge path.
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RuntimeBoardData } from "../src/core/api-contract";
import { mergeTaskWorktreesInDependencyOrder } from "../src/workspace/task-worktree-auto-merge";

const execFileAsync = promisify(execFile);
const SOURCE = "/private/var/folders/_k/dk3l4h_j0jg7p5pld9t7y65h0000gn/T/nklein-habit-insights-mid-1787075774730-fYoSsn";
const TASK_ID = "devtest-bed-cli-parser-medium-1787075774926";
const RESULT_COMMIT = "c24d6e94dfabcdefffffffffffffffffffffffff".slice(0, 7); // resolved below from the clone

const clone = await mkdtemp(join(tmpdir(), "merge-skip-probe-"));
await execFileAsync("git", ["clone", "--quiet", SOURCE, clone]);
// Local clone only fetches the default branch; copy the result branch ref explicitly.
const branchRef = `nklein/tasks/${TASK_ID}-0708a7a7c4`;
await execFileAsync("git", ["-C", clone, "fetch", "--quiet", "origin", `${branchRef}:${branchRef}`]);
const { stdout: commitOut } = await execFileAsync("git", ["-C", clone, "rev-parse", branchRef]);
const resultCommit = commitOut.trim();
process.stdout.write(`clone: ${clone}\nresult branch commit: ${resultCommit} (${RESULT_COMMIT} placeholder unused)\n`);

const board: RuntimeBoardData = {
	columns: [
		{ id: "backlog", title: "Backlog", cards: [] },
		{ id: "planning", title: "Planning", cards: [] },
		{ id: "ready", title: "Ready", cards: [] },
		{
			id: "review",
			title: "Review",
			cards: [{ id: TASK_ID, title: "probe", prompt: "probe", baseRef: "main" } as never],
		},
		{ id: "inProgress", title: "In Progress", cards: [] },
		{ id: "completed", title: "Completed", cards: [] },
		{ id: "trash", title: "Trash", cards: [] },
	],
	dependencies: [],
} as never;

const result = await mergeTaskWorktreesInDependencyOrder({
	repoPath: clone,
	board,
	columns: ["review"],
	taskIds: [TASK_ID],
	resultCommitOverrides: { [TASK_ID]: resultCommit },
});
process.stdout.write(`ok: ${result.ok} | merged: ${JSON.stringify(result.mergedTaskIds)} | skipped: ${JSON.stringify(result.skippedTaskIds)}\n`);
for (const step of result.steps) {
	process.stdout.write(`step: ${JSON.stringify(step)}\n`);
}
const { stdout: log } = await execFileAsync("git", ["-C", clone, "log", "--oneline", "-3"]);
process.stdout.write(`clone main after merge:\n${log}`);
await rm(clone, { recursive: true, force: true });
