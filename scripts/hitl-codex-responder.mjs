#!/usr/bin/env node
/**
 * Codex-in-the-model-seat responder for the HITL model server (bin/hitl-model-server.py).
 *
 *   HITL_ROOT=<queue dir> CODEX_MODEL=gpt-5.6-sol node scripts/hitl-codex-responder.mjs
 *
 * The sibling of `hitl-claude-responder.mjs`, answering the same queue with OpenAI's models through the `codex`
 * CLI instead of `claude`. Same contract in every respect that matters to the harness: every request lands in
 * `$HITL_ROOT/pending/<seq>.json`, and whoever writes `$HITL_ROOT/answers/<seq>.json` IS the model. The seat's
 * identity (CLI model id + version) goes to `$HITL_ROOT/seat.json` for the arm's harness card.
 *
 * Environment:
 * - `CODEX_MODEL` — the default seat (`gpt-5.6-sol`).
 * - `CODEX_MODEL_MAP` — `{"gpt-5.6-sol-rig":"gpt-5.6-sol",…}` picks the CLI model from the request's `model`;
 *   an unmapped id falls back to CODEX_MODEL. This is what lets ONE server expose several Codex seats at once.
 * - `CODEX_DEFAULT_EFFORT` — reasoning effort when the request names none (low|medium|high|xhigh|max|ultra).
 *   A request's own `reasoning_effort` always wins.
 * - `CODEX_RESPONDER_CONCURRENCY` — answer up to N queued requests at once.
 * - `CODEX_BIN` — the CLI to spawn. Defaults to `codex` on PATH, falling back to the plugin app-server copy,
 *   which is where a Codex install that was never linked onto PATH actually lives.
 *
 * Three things differ from the Claude rig, and all three are the CLI's doing:
 * - No structured-output flag, so the seat always answers in TEXT mode: the model writes the JSON object itself
 *   and the responder parses it. A reply that is not JSON becomes plain content rather than an error.
 * - No streaming deltas: `codex exec --json` emits completed items only, so there is nothing to forward as SSE.
 *   Turns arrive whole. (The HITL server does not require deltas; it just cannot show progress for this seat.)
 * - No tool-deny list. The sandbox is `read-only` and the working directory is the queue dir — an empty tree —
 *   so a seat that tries to act has nothing to act on. The prompt already tells it to emit tool_calls instead.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.env.HITL_ROOT ?? join(process.env.HOME ?? "", ".nklein", "factory-drains", "hitl-drain", "queue");
// LIVENESS — see the Claude responder for the incident this came from. A rig whose responder has died looks
// exactly like one thinking hard: the server holds the request for HITL_ANSWER_TIMEOUT_S and the caller hangs.
// The heartbeat lets the server answer "nobody is home" in milliseconds instead of ninety minutes.
const HEARTBEAT_PATH = join(ROOT, "responder.heartbeat");
const HEARTBEAT_EVERY_MS = 2_000;
let lastHeartbeat = 0;
function heartbeat(inFlight) {
	const now = Date.now();
	if (now - lastHeartbeat < HEARTBEAT_EVERY_MS) {
		return;
	}
	lastHeartbeat = now;
	try {
		writeFileSync(
			HEARTBEAT_PATH,
			`${JSON.stringify({ pid: process.pid, at: new Date(now).toISOString(), inFlight, kind: "codex-cli" })}\n`,
		);
	} catch {
		// A liveness stamp must never take the responder down with it.
	}
}
// A request older than the server's own answer timeout cannot still have a caller waiting on it.
const STALE_REQUEST_MS = Number(process.env.HITL_STALE_REQUEST_S ?? 5_400) * 1_000;

/** Park requests too old to still have a caller, so a restarted responder does not spend on abandoned turns. */
async function parkStaleRequests() {
	const parked = join(ROOT, `stale-${new Date().toISOString().slice(0, 10)}`);
	let names = [];
	try {
		names = (await readdir(join(ROOT, "pending"))).filter((name) => /^\d+\.json$/u.test(name));
	} catch {
		return;
	}
	const cutoff = Date.now() - STALE_REQUEST_MS;
	const stale = names.filter((name) => {
		try {
			return statSync(join(ROOT, "pending", name)).mtimeMs < cutoff;
		} catch {
			return false;
		}
	});
	if (stale.length === 0) {
		return;
	}
	await mkdir(parked, { recursive: true });
	for (const name of stale) {
		await rename(join(ROOT, "pending", name), join(parked, name)).catch(() => undefined);
	}
	log(`parked ${stale.length} request(s) older than ${Math.round(STALE_REQUEST_MS / 60_000)} min into ${parked}`);
}
const MODEL = process.env.CODEX_MODEL ?? "gpt-5.6-sol";
const CALL_TIMEOUT_MS = Number(process.env.CODEX_CALL_TIMEOUT_MS ?? 15 * 60_000);
const MAX_INPUT_CHARS = Number(process.env.CODEX_MAX_INPUT_CHARS ?? 600_000);
const CONCURRENCY = Math.max(1, Number(process.env.CODEX_RESPONDER_CONCURRENCY ?? 1) || 1);
const PLUGIN_CODEX = join(process.env.HOME ?? "", ".codex", "plugins", ".plugin-appserver", "codex");
const CODEX_BIN = process.env.CODEX_BIN ?? (existsSync(PLUGIN_CODEX) ? PLUGIN_CODEX : "codex");
const MODEL_MAP = (() => {
	try {
		const parsed = JSON.parse(process.env.CODEX_MODEL_MAP ?? "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
})();
// `ultra` is Codex-only (maximum reasoning with automatic task delegation); the rest match the Claude rig's set.
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const DEFAULT_EFFORT = EFFORT_LEVELS.has(process.env.CODEX_DEFAULT_EFFORT ?? "") ? process.env.CODEX_DEFAULT_EFFORT : null;

/** The CLI seat for a request: its `model` through CODEX_MODEL_MAP, else the configured default. */
function seatFor(request) {
	const mapped = typeof request?.model === "string" ? MODEL_MAP[request.model] : undefined;
	return typeof mapped === "string" && mapped ? mapped : MODEL;
}

/** The CLI effort for a request: a valid top-level `reasoning_effort`, else the configured default. */
function effortFor(request) {
	const effort = typeof request?.reasoning_effort === "string" ? request.reasoning_effort.trim().toLowerCase() : "";
	return EFFORT_LEVELS.has(effort) ? effort : DEFAULT_EFFORT;
}

function log(message) {
	process.stdout.write(`[${new Date().toISOString()}] ${message}\n`);
}

function messageText(content) {
	if (Array.isArray(content)) return content.map((part) => (part && typeof part === "object" ? (part.text ?? "") : "")).join("\n");
	return content ?? "";
}

/** The instruction that turns a chat request into "act as the model": the wire contract, verbatim tools, the transcript. */
function buildPrompt(request) {
	const tools = (request.tools ?? []).map((tool) => tool?.function ?? tool).filter(Boolean);
	const transcript = (request.messages ?? []).map((message) => {
		const parts = [`### ${message.role}${message.tool_call_id ? ` (tool_call_id=${message.tool_call_id})` : ""}`];
		for (const call of message.tool_calls ?? []) {
			const fn = call.function ?? {};
			parts.push(`[tool_call id=${call.id} name=${fn.name}] ${typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments)}`);
		}
		parts.push(messageText(message.content));
		return parts.join("\n");
	});
	let body = transcript.join("\n\n");
	if (body.length > MAX_INPUT_CHARS) {
		const head = body.slice(0, Math.floor(MAX_INPUT_CHARS * 0.3));
		const tail = body.slice(-Math.floor(MAX_INPUT_CHARS * 0.7));
		body = `${head}\n\n…[${body.length - head.length - tail.length} characters of older transcript elided]…\n\n${tail}`;
	}
	return [
		"You are the language model behind an OpenAI-compatible chat endpoint. The conversation below is the exact",
		"request an autonomous coding agent (nklein) sent you. Produce the assistant's NEXT message, nothing else.",
		"",
		"Rules of the wire:",
		'- Reply ONLY with one JSON object, no code fence, no prose before or after it: {"content": <your text, may be long>, "tool_calls": [{"name": <tool>, "arguments": {…}}…], "finish_reason": "stop"|"tool_calls"}. Put "content" FIRST.',
		"- You have NO tools of your own here. The only way to read, run or write anything is a tool_call the agent will",
		"  execute for you and return as a tool message in the next request. Do not narrate calls; emit them.",
		"- Follow the system prompt's instructions about tool protocol and deliverables literally. Prefer one decisive",
		"  action per turn over many speculative ones. Never invent tool results.",
		"- When the task is done per the system prompt, call the completing tool it names (if any) or finish with stop.",
		"",
		`## Tools offered (${tools.length})`,
		"```json",
		JSON.stringify(tools, null, 0),
		"```",
		"",
		"## Conversation",
		body,
	].join("\n");
}

/**
 * One non-interactive Codex turn. The prompt goes in on stdin (`-`), because a transcript is far past any safe
 * argv length. `--skip-git-repo-check` because the queue dir is not a repository, and `-s read-only` because a
 * model seat has no business writing anything.
 */
function runCodex(prompt, { model, effort }) {
	return new Promise((resolve, reject) => {
		const args = [
			"exec",
			"--skip-git-repo-check",
			"-s",
			"read-only",
			"-m",
			model,
			...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
			"--json",
			"-",
		];
		const child = spawn(CODEX_BIN, args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`codex exec timed out after ${CALL_TIMEOUT_MS} ms`));
		}, CALL_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) reject(new Error(`codex exec exited ${code}: ${stderr.slice(-800)}`));
			else resolve(stdout);
		});
		child.stdin.end(prompt);
	});
}

/**
 * The agent message and usage out of `codex exec --json`'s event stream.
 *
 * The stream carries `item.completed` envelopes; the seat's answer is the LAST one of type `agent_message`.
 * An `error` item is reported rather than swallowed — except the deprecation notice the CLI prints about its own
 * config, which says nothing about the turn.
 */
export function parseCodexEvents(stdout) {
	let text = "";
	let usage = null;
	const errors = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let event;
		try {
			event = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (event?.type === "turn.completed" && event.usage) usage = event.usage;
		if (event?.type !== "item.completed") continue;
		const item = event.item ?? {};
		if (item.type === "agent_message" && typeof item.text === "string") text = item.text;
		else if (item.type === "error" && typeof item.message === "string" && !/deprecated/iu.test(item.message)) errors.push(item.message);
	}
	return { text, usage, errors };
}

/** The JSON object in a text answer: fences stripped, the outermost braces taken (prose around them ignored). */
function parseAnswerObject(text) {
	const stripped = text.replace(/^```(?:json)?\s*|\s*```$/gu, "").trim();
	try {
		return JSON.parse(stripped);
	} catch {
		const start = stripped.indexOf("{");
		const end = stripped.lastIndexOf("}");
		if (start >= 0 && end > start) return JSON.parse(stripped.slice(start, end + 1));
		throw new Error("no JSON object in the answer");
	}
}

export function extractAnswer(stdout) {
	const { text, usage, errors } = parseCodexEvents(stdout);
	if (!text && errors.length > 0) throw new Error(errors.join("; "));
	let parsed;
	try {
		parsed = parseAnswerObject(text);
	} catch {
		// A seat that answered in prose instead of the JSON object: the prose IS the content.
		parsed = { content: text, tool_calls: [], finish_reason: "stop" };
	}
	if (!parsed || typeof parsed !== "object") throw new Error("no answer object in codex output");
	const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
	return {
		content: typeof parsed.content === "string" ? parsed.content : "",
		tool_calls: toolCalls
			.filter((call) => call && typeof call.name === "string")
			.map((call) => ({ name: call.name, arguments: call.arguments && typeof call.arguments === "object" ? call.arguments : {} })),
		finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
		usage,
	};
}

async function answerOne(seq) {
	const pendingPath = join(ROOT, "pending", `${seq}.json`);
	const answerPath = join(ROOT, "answers", `${seq}.json`);
	if (existsSync(answerPath)) return;
	const { request } = JSON.parse(await readFile(pendingPath, "utf8"));
	const prompt = buildPrompt(request);
	const model = seatFor(request);
	const effort = effortFor(request);
	const startedAt = Date.now();
	log(`request ${seq}: ${request.messages?.length ?? 0} messages, ${request.tools?.length ?? 0} tools, ${prompt.length} chars → ${model}${effort ? ` (effort ${effort})` : ""}`);
	let answer;
	try {
		answer = extractAnswer(await runCodex(prompt, { model, effort }));
	} catch (error) {
		const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
		log(`request ${seq}: FAILED (${reason}) — answering with an error message so the agent can recover`);
		answer = { content: `The model seat failed to answer this turn: ${reason}`, tool_calls: [], finish_reason: "stop" };
	}
	const tmp = `${answerPath}.tmp`;
	await writeFile(tmp, JSON.stringify({ content: answer.content, tool_calls: answer.tool_calls, finish_reason: answer.finish_reason }));
	await rename(tmp, answerPath);
	await writeFile(
		join(ROOT, "responder.jsonl"),
		`${JSON.stringify({ seq, seat: "codex-cli", model, effort, requestedModel: request.model ?? null, durationMs: Date.now() - startedAt, toolCalls: answer.tool_calls.map((call) => call.name), contentChars: answer.content.length, usage: answer.usage ?? null })}\n`,
		{ flag: "a" },
	);
	log(`request ${seq}: answered in ${Math.round((Date.now() - startedAt) / 1000)} s — ${answer.tool_calls.map((call) => call.name).join(",") || "text"}`);
}

async function main() {
	for (const sub of ["pending", "answers", "done", "digest"]) await mkdir(join(ROOT, sub), { recursive: true });
	let version = "unknown";
	try {
		version = await new Promise((resolve) => {
			const child = spawn(CODEX_BIN, ["--version"]);
			let out = "";
			child.stdout.on("data", (chunk) => {
				out += chunk;
			});
			child.on("error", () => resolve("unavailable"));
			child.on("close", () => resolve(out.trim() || "unknown"));
		});
	} catch {}
	await writeFile(
		join(ROOT, "seat.json"),
		JSON.stringify(
			{ kind: "codex-cli", model: MODEL, modelMap: MODEL_MAP, concurrency: CONCURRENCY, defaultEffort: DEFAULT_EFFORT, codexBin: CODEX_BIN, codexVersion: version, startedAt: new Date().toISOString() },
			null,
			2,
		),
	);
	log(`responder up: model ${MODEL}${Object.keys(MODEL_MAP).length > 0 ? ` (+map ${Object.keys(MODEL_MAP).join(",")})` : ""}, concurrency ${CONCURRENCY}, default effort ${DEFAULT_EFFORT ?? "cli"}, codex ${version}, root ${ROOT}`);
	const inFlight = new Set();
	await parkStaleRequests();
	for (;;) {
		heartbeat(inFlight.size);
		const pending = (await readdir(join(ROOT, "pending")))
			.filter((name) => /^\d+\.json$/u.test(name))
			.map((name) => Number(name.slice(0, -5)))
			.sort((a, b) => a - b);
		let did = false;
		for (const seq of pending) {
			if (inFlight.size >= CONCURRENCY) break;
			if (inFlight.has(seq) || existsSync(join(ROOT, "answers", `${seq}.json`))) continue;
			inFlight.add(seq);
			did = true;
			void answerOne(seq)
				.catch((error) => log(`request ${seq}: responder error ${error instanceof Error ? error.message : String(error)}`))
				.finally(() => inFlight.delete(seq));
		}
		if (!did) await new Promise((resolve) => setTimeout(resolve, 1500));
	}
}

if (process.env.CODEX_RESPONDER_IMPORT_ONLY !== "1") await main();
