/**
 * Abandon a !Klein run cleanly: move every card of a workspace to `trash` so nothing keeps driving it.
 *
 * ── WHY ──
 * Abandoning a run was a hand-written curl + python pipeline every time, and getting it wrong is expensive: on
 * 2026-09-08 nine cards were trashed by hand and their `::review` turns kept the rig's single shared endpoint for
 * hours (fixed separately in P0.TRASHREVIEW — the watchdog now sweeps those). The operation itself is one command
 * and belongs in the product, not in a shell history.
 *
 * ── LIMITATION, live 2026-09-09: TRASHING IS NOT ALWAYS ENOUGH ──
 * A card whose session is still mid-turn can come back. Project 41 was abandoned with all 8 cards trashed and two
 * minutes later the board read `{in_progress: 1, trash: 8}` — `task-runner-mutation-suite-result-ordering-tests`
 * had been restored out of trash by its own live session (the start path takes `resumeFromTrash: true`, which
 * exists for the bounce/re-drive case and does not distinguish an operator abandonment from one). The project kept
 * consuming the shared endpoint and its traffic kept landing in the NEXT project's recording.
 *
 * ── FIXED 2026-09-14 (P1.ZOMBIEBOARD): this script now RETIRES every abandoned card's session ──
 * After the board save it calls `runtime.retireTaskSession` for each card: the retirement ledger entry is recorded
 * first (no recovery path may restart the session), then the live session is stopped mid-turn. Do NOT reach for
 * `projects.remove` INSTEAD of this — removing a workspace with live sessions blinds the per-workspace watchdog and
 * creates a PERMANENT zombie (live 2026-09-11: a removed workspace's card consumed 26 of the next shift's 42
 * answers). Removing the workspace AFTER this script has retired its sessions is safe.
 *
 * Usage:  npx tsx scripts/hitl-abandon-run.mts <workspaceId> [--base http://127.0.0.1:3503]
 */
const workspaceId = process.argv[2];
const baseIndex = process.argv.indexOf("--base");
const base = (baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined) ?? "http://127.0.0.1:3503";
if (!workspaceId) {
	console.error("Usage: npx tsx scripts/hitl-abandon-run.mts <workspaceId> [--base <url>]");
	process.exit(1);
}
const api = `${base}/api/trpc`;
const headers = { "content-type": "application/json", "x-nklein-workspace-id": workspaceId };

const stateResponse = await fetch(`${api}/workspace.getState?workspaceId=${encodeURIComponent(workspaceId)}`, { headers });
if (!stateResponse.ok) {
	console.error(`workspace.getState failed: ${stateResponse.status} ${await stateResponse.text()}`);
	process.exit(1);
}
const state = (await stateResponse.json()).result.data;
const columns = state.board.columns as Array<{ id: string; cards: Array<{ id: string }> }>;
const trash = columns.find((column) => column.id === "trash");
if (!trash) {
	console.error("this board has no trash column");
	process.exit(1);
}
const moved: string[] = [];
const abandonedTaskIds: string[] = [];
for (const column of columns) {
	if (column.id === "trash") continue;
	for (const card of [...column.cards]) {
		moved.push(`${column.id}/${card.id}`);
		abandonedTaskIds.push(card.id);
		trash.cards.push(card);
	}
	column.cards = [];
}
if (moved.length === 0) {
	console.log("nothing to abandon — every card is already in trash");
	process.exit(0);
}
const saveResponse = await fetch(`${api}/workspace.saveState?workspaceId=${encodeURIComponent(workspaceId)}`, {
	method: "POST",
	headers,
	body: JSON.stringify(state),
});
if (!saveResponse.ok) {
	console.error(`workspace.saveState failed: ${saveResponse.status} ${await saveResponse.text()}`);
	process.exit(1);
}
console.log(`abandoned ${moved.length} card(s):\n  ${moved.join("\n  ")}`);
// The board is only half of it (P1.ZOMBIEBOARD): a trashed card whose session is mid-turn restores itself out of
// trash and keeps issuing requests, and removing the workspace would blind the watchdog that could stop it. RETIRE
// every session now — ledger entry first, then the stop — so nothing resurrects them.
let retired = 0;
for (const taskId of abandonedTaskIds) {
	const response = await fetch(`${api}/runtime.retireTaskSession?workspaceId=${encodeURIComponent(workspaceId)}`, {
		method: "POST",
		headers,
		body: JSON.stringify({ taskId, reason: "terminal_lane_card", detail: "abandoned via hitl-abandon-run" }),
	});
	const result = response.ok
		? ((await response.json()).result?.data as { ok?: boolean; stopped?: boolean } | undefined)
		: undefined;
	if (result?.ok) retired += 1;
	else console.error(`  retire ${taskId}: ${response.status} ${response.ok ? JSON.stringify(result) : await response.text()}`);
}
console.log(
	`\nretired ${retired}/${abandonedTaskIds.length} session(s) — nothing on this board can restart them; the workspace is now safe to remove.`,
);
