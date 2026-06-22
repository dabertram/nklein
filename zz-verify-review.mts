import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { runtimeAgentIdSchema } from "./src/core/api-contract.js";
import { buildKanbanRuntimeUrl, getRuntimeFetch } from "./src/core/runtime-endpoint.js";
import { buildWorkspaceScopeHeaders } from "./src/core/workspace-scope.js";
import { loadWorkspaceContext } from "./src/state/workspace-state.js";
import type { RuntimeAppRouter } from "./src/trpc/app-router.js";

function git(cwd: string, args: string[]): void {
	execFileSync("git", args, { cwd, stdio: "pipe" });
}

const dir = mkdtempSync(join(tmpdir(), "nklein-review-verify-"));
git(dir, ["init", "-b", "main"]);
git(dir, ["config", "user.name", "Verify"]);
git(dir, ["config", "user.email", "verify@example.com"]);
writeFileSync(join(dir, "README.md"), "# verify review\n");
git(dir, ["add", "."]);
git(dir, ["commit", "-m", "init"]);
console.log("temp repo:", dir);

const workspace = await loadWorkspaceContext(dir, { autoCreateIfMissing: true });
console.log("workspaceId:", workspace.workspaceId);

const client = createTRPCProxyClient<RuntimeAppRouter>({
	links: [
		httpBatchLink({
			url: buildKanbanRuntimeUrl("/api/trpc"),
			headers: () => buildWorkspaceScopeHeaders(workspace.workspaceId),
			fetch: async (url, options) => (await getRuntimeFetch())(url as string, options as RequestInit),
		}),
	],
});

const taskId = `verify-review-${Date.now()}`;
const nkleinSettings = { providerId: "lmstudio", modelId: "qwen3.5-9b-mtp-q4-k-xl-legion5pro-ctx80k" };
const prompt =
	"Create a file named hello.txt whose contents are exactly: hi\nDo the minimum; touch nothing else.\n\nAcceptance check: test -f hello.txt";
const now = Date.now();

const state = await client.workspace.getState.query();
const board = structuredClone(state.board);
const inProgress = board.columns.find((column) => column.id === "in_progress");
if (!inProgress) {
	throw new Error("no in_progress column");
}
inProgress.cards.push({
	id: taskId,
	title: "Verify second-opinion review",
	prompt,
	startInPlanMode: false,
	autoReviewEnabled: true,
	autoReviewMode: "commit",
	baseRef: "main",
	agentId: runtimeAgentIdSchema.catch("nklein").parse("nklein"),
	nkleinSettings,
	createdAt: now,
	updatedAt: now,
});
const saved = await client.workspace.saveState.mutate({ board, expectedRevision: state.revision });
console.log("saveState ok, revision:", saved.revision);

const started = await client.runtime.startTaskSession.mutate({
	taskId,
	prompt,
	taskTitle: "Verify second-opinion review",
	startInPlanMode: false,
	baseRef: "main",
	agentId: runtimeAgentIdSchema.catch("nklein").parse("nklein"),
	nkleinSettings,
});
console.log("startTaskSession:", JSON.stringify(started).slice(0, 200));
if (!started.ok) {
	console.log("START FAILED.");
	process.exit(2);
}

const deadlineMs = Date.now() + 20 * 60 * 1000;
let lastLine = "";
while (Date.now() < deadlineMs) {
	await new Promise((resolve) => setTimeout(resolve, 5000));
	let current: Awaited<ReturnType<typeof client.workspace.getState.query>>;
	try {
		current = await client.workspace.getState.query();
	} catch (error) {
		console.log("getState error:", error instanceof Error ? error.message : String(error));
		continue;
	}
	const found = current.board.columns
		.flatMap((column) => column.cards.map((card) => ({ col: column.id, card })))
		.find((entry) => entry.card.id === taskId);
	const review = found?.card.review;
	const line = `col=${found?.col ?? "(gone)"} review=${review ? `${review.status} round=${review.round}` : "none"}`;
	if (line !== lastLine) {
		console.log(new Date().toISOString(), line);
		lastLine = line;
	}
	if (review) {
		console.log("REVIEW STATE:\n", JSON.stringify(review, null, 2));
		if (review.status !== "in_review") {
			break;
		}
	}
	if (found?.col === "completed") {
		console.log("card COMPLETED (delivered). review:", JSON.stringify(review ?? null));
		break;
	}
}
console.log("done. workspace:", dir);
process.exit(0);
