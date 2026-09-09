/**
 * Turn a slice of the HITL rig's file queue into an aimock CAPTURE directory, so a real drive can be distilled
 * into simulator scenario tracks by the existing `scripts/distill-capture.mts`.
 *
 * ── WHY ──
 * The HITL rig (`bin/hitl-model-server.py`) is an OpenAI-compatible endpoint whose completions are written by hand
 * or by a model agent: every request lands in `queue/pending/<N>.json` and its answer in `queue/answers/<N>.json`.
 * That pair is exactly a recorded fixture — the same thing the record proxy captures — so a drive through the rig is
 * already a recording, and nothing new needs to observe the wire. This script only reshapes it.
 *
 * The result is a durable SYSTEM TEST: the scenario set replays the whole drive through the real runtime with no
 * model at all, which is how the Dschinn drive became `scenarios/36_dark_factory_dschinn_universal_agent`.
 *
 * Usage:
 *   npx tsx scripts/hitl-queue-to-capture.mts --out <captureDir> [--from <N>] [--to <N>] [--queue <dir>]
 *   npx tsx scripts/distill-capture.mts <captureDir> --out <tracks.json>
 *
 * `--from` is exclusive and is how you scope a capture to ONE project: note the highest answered id before seeding,
 * pass it, and only that project's traffic is captured.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface ChatMessage {
	role?: string;
	content?: unknown;
}

function argOf(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

const queueDir = resolve(
	argOf("--queue") ?? join(homedir(), ".nklein", "factory-drains", "hitl-drain", "queue"),
);
const outDir = argOf("--out") ? resolve(argOf("--out") as string) : undefined;
const from = Number(argOf("--from") ?? 0);
const to = Number(argOf("--to") ?? Number.MAX_SAFE_INTEGER);

if (!outDir) {
	console.error("Usage: npx tsx scripts/hitl-queue-to-capture.mts --out <captureDir> [--from <N>] [--to <N>] [--queue <dir>]");
	process.exit(1);
}

/** The rig stores content as a string or as an array of `{type,text}` parts; both must read as one string. */
function messageText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => (part && typeof part === "object" ? String((part as { text?: unknown }).text ?? "") : ""))
			.join("\n");
	}
	return "";
}

// The rig MOVES a request from `pending/` to `done/` once it is answered, so a completed drive lives almost
// entirely in `done/`. Read both, or a finished run captures nothing.
const requestDirs = ["done", "pending"].filter((name) => existsSync(join(queueDir, name)));
const idToDir = new Map<number, string>();
for (const dir of requestDirs) {
	for (const name of readdirSync(join(queueDir, dir))) {
		const id = Number(name.replace(/\.json$/u, ""));
		if (Number.isInteger(id) && id > from && id <= to && !idToDir.has(id)) {
			idToDir.set(id, dir);
		}
	}
}
const ids = [...idToDir.keys()].sort((left, right) => left - right);

mkdirSync(outDir, { recursive: true });
let captured = 0;
let unanswered = 0;

/**
 * Requests that belong to NO single project, and therefore poison any project's recording.
 *
 * Live 2026-09-10: project 41's capture held 89 tracks of which only 50 were its own — 27 came from project 40,
 * still being driven, and 7 from `main-branch-custodian::review`. Its replay duly started on another project's
 * traffic and never drove 41's board, failing `left cards undrained`. Project 40 failed the same way an hour
 * earlier.
 *
 * The custodian sweep reviews the MAIN BRANCH across projects; it is not part of any project's flow, it re-drives
 * itself continuously (P1.SETTLEDNUDGE — five shifts, up to 45% of a shift's turns), and every request it makes
 * inside a capture window lands in whatever project happens to be recording. Excluding it is not a heuristic: a
 * cross-project card has no place in a single project's scenario set, whatever else is wrong with it.
 */
const CROSS_PROJECT_TASK_MARKERS = ["main-branch-custodian"];

/** The sandbox workdir a request names (`/workspaces/<taskId>`) — the only per-request task marker on the wire. */
function workspaceMarkersOf(request: unknown): string[] {
	return [
		...new Set(
			[...JSON.stringify(request).matchAll(/\/workspaces\/([a-zA-Z0-9._-]+)/gu)].map((match) => match[1] ?? ""),
		),
	];
}

const skippedCrossProject: number[] = [];
const workspaceFamilies = new Map<string, number>();

for (const id of ids) {
	const answerPath = join(queueDir, "answers", `${id}.json`);
	if (!existsSync(answerPath)) {
		// An unanswered request is a turn the model never took: it has no response to record, and inventing one
		// would put words in the model's mouth. Count it so the caller knows the recording has holes.
		unanswered += 1;
		continue;
	}
	let request: { messages?: ChatMessage[]; model?: string };
	let answer: { content?: string; tool_calls?: Array<{ name: string; arguments: unknown }>; finish_reason?: string };
	try {
		request = JSON.parse(readFileSync(join(queueDir, idToDir.get(id) as string, `${id}.json`), "utf8")).request;
		answer = JSON.parse(readFileSync(answerPath, "utf8"));
	} catch (error) {
		console.warn(`skipping ${id}: ${error instanceof Error ? error.message : String(error)}`);
		continue;
	}
	const markers = workspaceMarkersOf(request);
	if (markers.some((marker) => CROSS_PROJECT_TASK_MARKERS.some((cross) => marker.includes(cross)))) {
		skippedCrossProject.push(id);
		continue;
	}
	for (const marker of markers) {
		workspaceFamilies.set(marker, (workspaceFamilies.get(marker) ?? 0) + 1);
	}
	const messages = request.messages ?? [];
	// Wire truth 5: the per-session turn index IS the assistant-message count of the request.
	const turnIndex = messages.filter((message) => message.role === "assistant").length;
	const lastUser = [...messages].reverse().find((message) => message.role === "user");
	const seedUser = messages.find((message) => message.role === "user");
	const toolCalls = (answer.tool_calls ?? []).map((call) => ({ name: call.name, arguments: call.arguments }));

	const entry = {
		match: {
			// The SEED user message is what a track's needle matches on; the last user message is the turn's own
			// context (a tool result, a nudge), which the distiller uses to order turns within a session.
			userMessage: messageText(seedUser?.content),
			model: request.model ?? "claude-hitl",
			turnIndex,
			hasToolResult: /\[tool_result/u.test(messageText(lastUser?.content)),
			context: messageText(lastUser?.content).slice(0, 4000),
		},
		response: {
			status: 200,
			content: answer.content ?? "",
			toolCalls,
			finishReason: answer.finish_reason ?? (toolCalls.length > 0 ? "tool_calls" : "stop"),
		},
		provenance: { source: "hitl-queue", requestId: id },
	};
	writeFileSync(join(outDir, `${String(id).padStart(6, "0")}.json`), `${JSON.stringify(entry, null, "\t")}\n`, "utf8");
	captured += 1;
}

console.log(
	`captured ${captured} request/answer pair(s) from ${queueDir} into ${outDir}` +
		(unanswered > 0 ? ` — ${unanswered} request(s) were never answered and are NOT in the recording` : ""),
);
if (skippedCrossProject.length > 0) {
	console.log(
		`excluded ${skippedCrossProject.length} cross-project request(s) (${CROSS_PROJECT_TASK_MARKERS.join(", ")}): ` +
			`${skippedCrossProject.slice(0, 8).join(", ")}${skippedCrossProject.length > 8 ? ", …" : ""}`,
	);
}
// A capture spanning many unrelated task families is the shape that replays as "left cards undrained": the replay
// starts on another project's traffic. Say so loudly rather than letting it surface as a mystery later.
const families = [...workspaceFamilies.entries()].sort((left, right) => right[1] - left[1]);
if (families.length > 1) {
	console.log(
		`NOTE: this capture spans ${families.length} distinct task workspaces — if its replay leaves cards undrained, ` +
			`foreign traffic is the first thing to check:\n  ` +
			families
				.slice(0, 6)
				.map(([name, count]) => `${count}x ${name}`)
				.join("\n  "),
	);
}
