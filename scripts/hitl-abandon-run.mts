/**
 * Abandon a !Klein run cleanly: move every card of a workspace to `trash` so nothing keeps driving it.
 *
 * ── WHY ──
 * Abandoning a run was a hand-written curl + python pipeline every time, and getting it wrong is expensive: on
 * 2026-09-08 nine cards were trashed by hand and their `::review` turns kept the rig's single shared endpoint for
 * hours (fixed separately in P0.TRASHREVIEW — the watchdog now sweeps those). The operation itself is one command
 * and belongs in the product, not in a shell history.
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
for (const column of columns) {
	if (column.id === "trash") continue;
	for (const card of [...column.cards]) {
		moved.push(`${column.id}/${card.id}`);
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
// The board is only half of it: a trashed card's live session and its `::review` model-turn reservation are stopped
// by the board-liveness watchdog on its next tick (P0.TRASHREVIEW). Say so, because "the board looks empty but the
// endpoint is still busy" was the exact confusion this whole area produced.
console.log("\nThe board-liveness watchdog stops their sessions and frees the endpoint on its next tick.");
