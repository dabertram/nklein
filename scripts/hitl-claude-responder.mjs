#!/usr/bin/env node
/**
 * Claude-in-the-model-seat responder for the HITL model server (bin/hitl-model-server.py).
 *
 *   HITL_ROOT=<queue dir> CLAUDE_MODEL=claude-sonnet-5 node scripts/hitl-claude-responder.mjs
 *
 * Optional (2026-09-15, the dsh Claude rig): `CLAUDE_MODEL_MAP='{"claude-sonnet-5-rig":"claude-sonnet-5",…}'` picks the
 * CLI model from the request's `model` (unmapped ids fall back to CLAUDE_MODEL); the request's `reasoning_effort`
 * (low|medium|high|xhigh|max) becomes the CLI's `--effort`; `CLAUDE_RESPONDER_CONCURRENCY=N` answers up to N queued
 * requests at once (an interactive harness fires side requests — titles, summaries — beside the agent turn).
 *
 * The HITL server exposes an OpenAI-compatible endpoint whose completions are answered out of band: every request
 * lands in `$HITL_ROOT/pending/<seq>.json`, and whoever writes `$HITL_ROOT/answers/<seq>.json` IS the model. Earlier
 * drives had Claude answer that queue by hand or through canned deliveries; this responder answers it with a Claude
 * model through the `claude` CLI in print mode — one non-interactive call per request, every Claude Code tool
 * disallowed, structured output enforced by a JSON schema — so a whole SWE-bench arm can run with Sonnet or Opus in
 * the seat without a human in the loop. The seat's identity (CLI model id + version) is written to
 * `$HITL_ROOT/seat.json` for the arm's harness card.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.env.HITL_ROOT ?? join(process.env.HOME ?? "", ".nklein", "factory-drains", "hitl-drain", "queue");
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5";
const CALL_TIMEOUT_MS = Number(process.env.CLAUDE_CALL_TIMEOUT_MS ?? 15 * 60_000);
const MAX_INPUT_CHARS = Number(process.env.CLAUDE_MAX_INPUT_CHARS ?? 600_000);
const CONCURRENCY = Math.max(1, Number(process.env.CLAUDE_RESPONDER_CONCURRENCY ?? 1) || 1);
const MODEL_MAP = (() => {
	try {
		const parsed = JSON.parse(process.env.CLAUDE_MODEL_MAP ?? "{}");
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
})();
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
// The CLI's default effort lets a frontier seat think without limit: on the dsh rig one prose turn spent 58k of its
// 63k output tokens thinking (15 minutes for a 4 KB file). A request that names no reasoning_effort gets this default.
const DEFAULT_EFFORT = EFFORT_LEVELS.has(process.env.CLAUDE_DEFAULT_EFFORT ?? "") ? process.env.CLAUDE_DEFAULT_EFFORT : null;
// ANSWER MODE. "schema" = the CLI's --json-schema (the seat's answer is enforced by a StructuredOutput tool — but the
// CLI runs TWO passes for it: the model answers in text first, then is told to call the tool and generates the whole
// answer again; every turn costs and waits double). "text" = one pass: the model writes the JSON object itself and the
// responder parses it (a reply that is not JSON becomes plain content). The dsh rig runs text mode; the SWE-bench arms
// keep schema mode for pass-1 comparability.
const ANSWER_MODE = process.env.CLAUDE_ANSWER_MODE === "text" ? "text" : "schema";
// STREAMING: with CLAUDE_STREAM=1 the CLI emits partial events; thinking deltas and the `content` string (decoded
// incrementally out of the JSON the model is typing) are appended to answers/<seq>.stream.jsonl, which the HITL
// server forwards to the client as SSE deltas while the turn is still running.
const STREAM = process.env.CLAUDE_STREAM === "1";
// BUDGET AND QUOTA GUARD. A long arm must not run the subscription into overage, and it must not record a
// quota refusal AS THE MODEL'S ANSWER — that would silently corrupt a benchmark with turns the model never took.
// `CLAUDE_MAX_COST_USD` is a hard stop on the cost the CLI itself reports; reaching it stops answering, and the
// run stalls visibly instead of spending. A usage-limit error PAUSES and retries rather than answering, because
// "we are out of quota" is not a turn.
const MAX_COST_USD = Number(process.env.CLAUDE_MAX_COST_USD ?? 0) || 0;
const QUOTA_PAUSE_MS = Number(process.env.CLAUDE_QUOTA_PAUSE_MS ?? 10 * 60_000);
const QUOTA_SIGNS =
	/usage limit|rate.?limit|quota|too many requests|429|insufficient credit|billing|upgrade your plan|overloaded/iu;
let spentUsd = 0;
let budgetStopped = false;

/** Whether an error is the subscription saying no, rather than the model failing a turn. */
function isQuotaRefusal(error) {
	return QUOTA_SIGNS.test(error instanceof Error ? error.message : String(error));
}

/** The CLI seat for a request: its `model` through CLAUDE_MODEL_MAP, else the configured default. */
function seatFor(request) {
	const mapped = typeof request?.model === "string" ? MODEL_MAP[request.model] : undefined;
	return typeof mapped === "string" && mapped ? mapped : MODEL;
}

/** The CLI effort for a request: a valid top-level `reasoning_effort`, else none (the CLI default). */
function effortFor(request) {
	const effort = typeof request?.reasoning_effort === "string" ? request.reasoning_effort.trim().toLowerCase() : "";
	return EFFORT_LEVELS.has(effort) ? effort : DEFAULT_EFFORT;
}

const ANSWER_SCHEMA = {
	type: "object",
	properties: {
		content: { type: "string", description: "The assistant's text for this turn ('' when only calling tools)." },
		tool_calls: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					arguments: { type: "object", additionalProperties: true },
				},
				required: ["name", "arguments"],
				additionalProperties: false,
			},
		},
		finish_reason: { type: "string", enum: ["stop", "tool_calls"] },
	},
	required: ["content", "tool_calls", "finish_reason"],
	additionalProperties: false,
};

// Only names the CLI knows — an unknown name in the deny list aborts the call ("matches no known tool").
const DISALLOWED_TOOLS = "Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch,Agent,NotebookEdit,TodoWrite";

function log(message) {
	const line = `[${new Date().toISOString()}] ${message}`;
	process.stdout.write(`${line}\n`);
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
		// Keep the system prompt and the newest turns; elide the middle (the model sees the truncation).
		const head = body.slice(0, Math.floor(MAX_INPUT_CHARS * 0.3));
		const tail = body.slice(-Math.floor(MAX_INPUT_CHARS * 0.7));
		body = `${head}\n\n…[${body.length - head.length - tail.length} characters of older transcript elided]…\n\n${tail}`;
	}
	return [
		"You are the language model behind an OpenAI-compatible chat endpoint. The conversation below is the exact",
		"request an autonomous coding agent (nklein) sent you. Produce the assistant's NEXT message, nothing else.",
		"",
		"Rules of the wire:",
		ANSWER_MODE === "text"
			? '- Reply ONLY with one JSON object, no code fence, no prose before or after it: {"content": <your text, may be long>, "tool_calls": [{"name": <tool>, "arguments": {…}}…], "finish_reason": "stop"|"tool_calls"}. Put "content" FIRST.'
			: "- Reply ONLY as the JSON object of the required schema: content (your text), tool_calls (zero or more calls to",
		"  the tools offered BELOW, with arguments matching each tool's JSON schema exactly), finish_reason",
		"  ('tool_calls' when tool_calls is non-empty, else 'stop').",
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
 * Decodes the `content` string value out of the JSON object the model is typing, character by character, so the
 * text can be forwarded while the rest of the object is still being generated. Waits for the `"content": "` key,
 * then JSON-unescapes until the closing quote (a trailing incomplete escape is held back until it completes).
 */
function createContentStreamer(emit) {
	const ESCAPES = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f" };
	let raw = "";
	let phase = "seek";
	return (delta) => {
		if (phase === "done") return;
		raw += delta;
		if (phase === "seek") {
			const match = /"content"\s*:\s*"/u.exec(raw);
			if (!match) return;
			phase = "in";
			raw = raw.slice(match.index + match[0].length);
		}
		let out = "";
		let i = 0;
		while (i < raw.length) {
			const ch = raw[i];
			if (ch === '"') {
				phase = "done";
				break;
			}
			if (ch === "\\") {
				if (i + 1 >= raw.length) break;
				const next = raw[i + 1];
				if (next === "u") {
					if (i + 6 > raw.length) break;
					out += String.fromCharCode(Number.parseInt(raw.slice(i + 2, i + 6), 16));
					i += 6;
					continue;
				}
				out += ESCAPES[next] ?? next;
				i += 2;
				continue;
			}
			out += ch;
			i += 1;
		}
		raw = raw.slice(i);
		if (out) emit(out);
	};
}

function runClaude(prompt, { model, effort, onThinking, onText }) {
	return new Promise((resolve, reject) => {
		const args = [
			"-p",
			"--model",
			model,
			...(effort ? ["--effort", effort] : []),
			// NOT --bare: bare mode skips the keychain login and returns an empty answer (exit 1, 0 api ms).
			"--no-session-persistence",
			...(STREAM ? ["--output-format", "stream-json", "--include-partial-messages", "--verbose"] : ["--output-format", "json"]),
			...(ANSWER_MODE === "schema" ? ["--json-schema", JSON.stringify(ANSWER_SCHEMA)] : []),
			"--disallowedTools",
			DISALLOWED_TOOLS,
			"--append-system-prompt",
			ANSWER_MODE === "text"
				? "You answer as a machine endpoint: output only the JSON answer object described by the user message; no prose, no code fence outside it."
				: "You answer as a machine endpoint: output only the structured JSON answer; no prose outside it.",
		];
		// cwd = the queue dir: an empty directory, so no project CLAUDE.md/AGENTS.md is loaded into every call.
		const child = spawn("claude", args, {
			cwd: ROOT,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: "16000" },
		});
		let stdout = "";
		let stderr = "";
		let lineBuffer = "";
		let resultEnvelope = null;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`claude -p timed out after ${CALL_TIMEOUT_MS} ms`));
		}, CALL_TIMEOUT_MS);
		const onStreamLine = (line) => {
			let event;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}
			if (event?.type === "result") resultEnvelope = event;
			if (event?.type !== "stream_event") return;
			const delta = event.event?.delta;
			if (!delta || event.event?.type !== "content_block_delta") return;
			if (delta.type === "thinking_delta" && typeof delta.thinking === "string") onThinking?.(delta.thinking);
			else if (delta.type === "text_delta" && typeof delta.text === "string") onText?.(delta.text);
			else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") onText?.(delta.partial_json);
		};
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			if (!STREAM) return;
			lineBuffer += chunk;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) if (line.trim()) onStreamLine(line);
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
			if (STREAM && lineBuffer.trim()) onStreamLine(lineBuffer);
			if (code !== 0) reject(new Error(`claude -p exited ${code}: ${stderr.slice(-800)}`));
			else if (STREAM) resolve(resultEnvelope ?? { result: "" });
			else resolve(stdout);
		});
		child.stdin.end(prompt);
	});
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

function extractAnswer(raw) {
	const envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
	const candidate = envelope.structured_output ?? envelope.result ?? envelope;
	let parsed;
	if (typeof candidate === "string") {
		try {
			parsed = parseAnswerObject(candidate);
		} catch (error) {
			if (ANSWER_MODE !== "text") throw error;
			// A text-mode seat that answered in prose instead of the JSON object: the prose IS the content.
			parsed = { content: candidate, tool_calls: [], finish_reason: "stop" };
		}
	} else {
		parsed = candidate;
	}
	if (!parsed || typeof parsed !== "object") throw new Error("no answer object in claude output");
	const toolCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
	return {
		content: typeof parsed.content === "string" ? parsed.content : "",
		tool_calls: toolCalls
			.filter((call) => call && typeof call.name === "string")
			.map((call) => ({ name: call.name, arguments: call.arguments && typeof call.arguments === "object" ? call.arguments : {} })),
		finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
		usage: envelope.usage ?? null,
		costUsd: envelope.total_cost_usd ?? null,
		durationMs: envelope.duration_ms ?? null,
	};
}

async function answerOne(seq) {
	const pendingPath = join(ROOT, "pending", `${seq}.json`);
	const answerPath = join(ROOT, "answers", `${seq}.json`);
	if (existsSync(answerPath)) return;
	if (budgetStopped) return;
	if (MAX_COST_USD > 0 && spentUsd >= MAX_COST_USD) {
		budgetStopped = true;
		log(`BUDGET REACHED: $${spentUsd.toFixed(2)} of $${MAX_COST_USD.toFixed(2)} — answering nothing further. Raise CLAUDE_MAX_COST_USD and restart the responder to continue.`);
		return;
	}
	const { request } = JSON.parse(await readFile(pendingPath, "utf8"));
	const prompt = buildPrompt(request);
	const model = seatFor(request);
	const effort = effortFor(request);
	const startedAt = Date.now();
	log(`request ${seq}: ${request.messages?.length ?? 0} messages, ${request.tools?.length ?? 0} tools, ${prompt.length} chars → ${model}${effort ? ` (effort ${effort})` : ""}`);
	const streamPath = join(ROOT, "answers", `${seq}.stream.jsonl`);
	const appendStream = (record) => appendFileSync(streamPath, `${JSON.stringify(record)}\n`);
	const streamContent = createContentStreamer((text) => appendStream({ content: text }));
	let answer;
	try {
		answer = extractAnswer(
			await runClaude(prompt, {
				model,
				effort,
				onThinking: STREAM ? (text) => appendStream({ reasoning: text }) : undefined,
				onText: STREAM ? streamContent : undefined,
			}),
		);
	} catch (error) {
		if (isQuotaRefusal(error)) {
			// NOT an answer. Leave the request pending so the loop retries it after the pause; the arm stalls where
			// anyone can see it rather than banking a refusal as the model's turn.
			log(`request ${seq}: QUOTA/RATE LIMIT (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — pausing ${Math.round(QUOTA_PAUSE_MS / 1000)} s and retrying, NOT answering`);
			await new Promise((resolve) => setTimeout(resolve, QUOTA_PAUSE_MS));
			return;
		}
		log(`request ${seq}: FAILED (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — answering with an error message so the agent can recover`);
		answer = { content: `The model seat failed to answer this turn: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, tool_calls: [], finish_reason: "stop" };
	}
	const tmp = `${answerPath}.tmp`;
	await writeFile(tmp, JSON.stringify({ content: answer.content, tool_calls: answer.tool_calls, finish_reason: answer.finish_reason }));
	await rename(tmp, answerPath);
	if (typeof answer.costUsd === "number") {
		spentUsd += answer.costUsd;
		if (MAX_COST_USD > 0 && spentUsd >= MAX_COST_USD) {
			budgetStopped = true;
			log(`BUDGET REACHED: $${spentUsd.toFixed(2)} of $${MAX_COST_USD.toFixed(2)} — this was the last answer.`);
		}
	}
	await writeFile(
		join(ROOT, "responder.jsonl"),
		`${JSON.stringify({ seq, model, effort, requestedModel: request.model ?? null, durationMs: Date.now() - startedAt, toolCalls: answer.tool_calls.map((call) => call.name), contentChars: answer.content.length, usage: answer.usage, costUsd: answer.costUsd })}\n`,
		{ flag: "a" },
	);
	log(`request ${seq}: answered in ${Math.round((Date.now() - startedAt) / 1000)} s — ${answer.tool_calls.map((call) => call.name).join(",") || "text"}${MAX_COST_USD > 0 ? ` | spent $${spentUsd.toFixed(2)} of $${MAX_COST_USD.toFixed(2)}` : ""}`);
}

async function main() {
	for (const sub of ["pending", "answers", "done", "digest"]) await mkdir(join(ROOT, sub), { recursive: true });
	let version = "unknown";
	try {
		version = await new Promise((resolve) => {
			const child = spawn("claude", ["--version"]);
			let out = "";
			child.stdout.on("data", (chunk) => {
				out += chunk;
			});
			child.on("close", () => resolve(out.trim()));
		});
	} catch {}
	await writeFile(
		join(ROOT, "seat.json"),
		JSON.stringify(
			{ kind: "claude-cli", model: MODEL, modelMap: MODEL_MAP, concurrency: CONCURRENCY, answerMode: ANSWER_MODE, stream: STREAM, defaultEffort: DEFAULT_EFFORT, claudeVersion: version, startedAt: new Date().toISOString() },
			null,
			2,
		),
	);
	log(`responder up: model ${MODEL}${Object.keys(MODEL_MAP).length > 0 ? ` (+map ${Object.keys(MODEL_MAP).join(",")})` : ""}, concurrency ${CONCURRENCY}, default effort ${DEFAULT_EFFORT ?? "cli"}, answer mode ${ANSWER_MODE}${STREAM ? " (streaming)" : ""}, claude ${version}, root ${ROOT}`);
	// Up to CONCURRENCY requests in flight at once; each is claimed exactly once (the in-flight set), answered, released.
	const inFlight = new Set();
	for (;;) {
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

await main();
