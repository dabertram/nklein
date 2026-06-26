/**
 * §5.AI continuous dev-test evaluation rail (first usable version). Runs SEVERAL dev-test projects **in parallel**
 * against the live local model + Docker, streams a watchable live view of each project's TASK FLOW (decompose → cards
 * → tool calls → terminal state), and collects per-project runtime evidence — success AND failure — into a report you
 * can read (and feed back into todo.md). This is the "watch the dev projects do their work + harvest real evidence"
 * instance the user asked for; the always-on / idle-aware / restart-survivable + auto-into-todos layers (the full §5.AI)
 * sit on the §5.AF durable scheduler and come later.
 *
 * Requires a runtime already running on :3484 (`npm run dev:full`), a live LM Studio with the model loaded, and Docker
 * (strict isolation, same as real tasks). It pins the model + raises that model's per-request concurrency (§5.T) so the
 * single endpoint genuinely serves the projects concurrently, then RESTORES both + removes the throwaway projects.
 *
 * Run:  tsx scripts/dev-test-rail.mts --projects mid_task,complex_dag --model qwen/qwen3-8b-m5max --max-wait-ms 900000
 *       tsx scripts/dev-test-rail.mts --count 3              # pick N at random from the built-in presets
 */
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { resolveNKleinDevTestProjectScenario } from "../src/nklein-agent/nklein-dev-test-project";
import type { RuntimeAppRouter } from "../src/trpc/app-router";

const URL_BASE = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3484";
const TRPC_URL = `${URL_BASE}/api/trpc`;
const ENDPOINT_BASE_URL = "http://127.0.0.1:1234/v1";
/** The built-in presets `createDevTestProject` accepts (proven to run; registry ids also work via --projects). */
const BUILTIN_PRESETS = ["mid_task", "complex_dag", "audio_vst", "daw_foundation"] as const;
const TERMINAL_STATES = new Set(["awaiting_review", "completed", "failed"]);
const NARRATION_MARKERS = /<\|?\s*(?:tool_call|function_call|python_tag)\s*\|?>|\[TOOL_CALLS\]|<function\s*=|\[TOOL_REQUEST\]/i;

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}
function log(line = ""): void {
	process.stdout.write(`${line}\n`);
}

type Preset = Parameters<typeof resolveNKleinDevTestProjectScenario>[0];

interface CapturedMessage {
	taskId: string;
	role: string;
	toolName: string | null;
	content: string;
	at: number;
}

/** One project's live lane on the rail. */
interface Lane {
	label: string;
	preset: Preset;
	workspaceId: string;
	seedTaskId: string;
	ws: ReturnType<typeof createTRPCProxyClient<RuntimeAppRouter>>;
	socket: WebSocket;
	messages: CapturedMessage[];
	startedOk: boolean;
	startError: string | null;
	/** taskId → latest known session state (live cascade view). */
	sessionStates: Map<string, string>;
	terminalState: string | null;
	cardCount: number;
	frames: number;
}

function selectPresets(): Preset[] {
	const explicit = arg("projects", "").trim();
	if (explicit) {
		return explicit.split(",").map((value) => value.trim()).filter(Boolean) as Preset[];
	}
	const count = Math.max(1, Math.min(BUILTIN_PRESETS.length, Number.parseInt(arg("count", "2"), 10)));
	// Default selection = the first `count` built-in presets (random rotation is a later policy; §5.AI).
	return BUILTIN_PRESETS.slice(0, count) as unknown as Preset[];
}

async function main(): Promise<void> {
	const model = arg("model", "qwen/qwen3-8b-m5max");
	const presets = selectPresets();
	const maxWaitMs = Number.parseInt(arg("max-wait-ms", "900000"), 10); // generous default: 15 min (small models are slow)
	const concurrency = Math.max(presets.length, Number.parseInt(arg("concurrency", String(presets.length)), 10));

	const base = createTRPCProxyClient<RuntimeAppRouter>({ links: [httpBatchLink({ url: TRPC_URL })] });

	// ── Pin the model + raise its per-request concurrency so the one endpoint serves the projects concurrently. ──
	const before = await base.runtime.getConfig.query();
	const original = before.nkleinProviderSettings;
	log(`Rail: ${presets.length} projects in parallel on ${model} (concurrency ${concurrency})`);
	log(`Projects: ${presets.join(", ")}\n`);
	await base.runtime.saveNKleinProviderSettings.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL });
	await base.runtime.saveNKleinModelMaxConcurrentRequests
		.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL, maxConcurrentRequests: concurrency })
		.catch((error) => log(`(could not set per-model concurrency: ${error instanceof Error ? error.message : String(error)})`));

	const lanes: Lane[] = [];
	const cleanup = async () => {
		for (const lane of lanes) {
			try {
				lane.socket.close();
			} catch {}
		}
		await base.runtime.saveNKleinModelMaxConcurrentRequests
			.mutate({ providerId: "lmstudio", modelId: model, baseUrl: ENDPOINT_BASE_URL, maxConcurrentRequests: null })
			.catch(() => undefined);
		await base.runtime.saveNKleinProviderSettings
			.mutate({ providerId: "lmstudio", modelId: original.modelId, baseUrl: original.baseUrl })
			.catch(() => undefined);
		for (const lane of lanes) {
			for (let attempt = 0; attempt < 4; attempt += 1) {
				await base.projects.remove.mutate({ projectId: lane.workspaceId }).catch(() => undefined);
				const stillThere = (await base.projects.list.query().catch(() => ({ projects: [] }))).projects.some(
					(project) => project.id === lane.workspaceId,
				);
				if (!stillThere) break;
				await new Promise((resolve) => setTimeout(resolve, 800));
			}
		}
	};

	try {
		// ── Create + subscribe + start each project. ──
		for (const preset of presets) {
			const created = await base.projects.createDevTestProject.mutate({ preset }).catch((error) => ({ ok: false, error: String(error) }) as const);
			if (!("ok" in created) || !created.ok || !("project" in created) || !created.project || !created.task) {
				log(`✗ ${preset}: createDevTestProject failed (${(created as { error?: string }).error ?? "unknown"}) — skipping`);
				continue;
			}
			const workspaceId = created.project.id;
			const seedTaskId = created.task.id;
			const ws = createTRPCProxyClient<RuntimeAppRouter>({
				links: [httpBatchLink({ url: TRPC_URL, headers: () => ({ "x-nklein-workspace-id": workspaceId }) })],
			});
			const lane: Lane = {
				label: preset,
				preset,
				workspaceId,
				seedTaskId,
				ws,
				socket: new WebSocket(`${URL_BASE.replace(/^http/, "ws")}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`),
				messages: [],
				startedOk: false,
				startError: null,
				sessionStates: new Map(),
				terminalState: null,
				cardCount: 0,
				frames: 0,
			};
			lane.socket.addEventListener("message", (event) => {
				lane.frames += 1;
				try {
					const frame = JSON.parse(String(event.data)) as {
						type?: string;
						taskId?: string;
						message?: { role?: string; content?: string; meta?: { toolName?: string | null } };
					};
					if (frame.type === "task_chat_message" && frame.taskId) {
						const message = frame.message ?? {};
						lane.messages.push({
							taskId: frame.taskId,
							role: message.role ?? "?",
							toolName: message.meta?.toolName ?? null,
							content: message.content ?? "",
							at: Date.now(),
						});
					}
				} catch {}
			});
			await new Promise<void>((resolve) => {
				lane.socket.addEventListener("open", () => resolve());
				lane.socket.addEventListener("error", () => resolve());
			});
			lanes.push(lane);

			const scenario = resolveNKleinDevTestProjectScenario(preset);
			const started = await ws.runtime.startTaskSession
				.mutate({ taskId: seedTaskId, prompt: scenario.prompt, taskTitle: scenario.title, baseRef: "main", agentId: "nklein", startInPlanMode: false })
				.catch((error) => ({ ok: false, error: String(error) }) as const);
			lane.startedOk = "ok" in started ? started.ok : false;
			lane.startError = "error" in started ? (started.error ?? null) : null;
			log(`▶ ${preset}: project=${workspaceId.slice(0, 8)} seed=${seedTaskId.slice(0, 8)} start=${lane.startedOk ? "ok" : `FAILED(${lane.startError})`}`);
		}

		if (lanes.length === 0) {
			throw new Error("No dev-test projects could be created — nothing to run.");
		}

		// ── Live watch loop: render every project's task flow until all terminal or deadline. ──
		log(`\nWatching ${lanes.length} projects (deadline ${(maxWaitMs / 60000).toFixed(0)} min)…\n`);
		const deadline = Date.now() + maxWaitMs;
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 7000));
			let allTerminal = true;
			const rows: string[] = [];
			for (const lane of lanes) {
				const state = (await lane.ws.workspace.getState.query().catch(() => null)) as {
					board?: { cards?: unknown[] };
					sessions?: Record<string, { state?: string }>;
				} | null;
				lane.cardCount = state?.board?.cards?.length ?? lane.cardCount;
				for (const [taskId, session] of Object.entries(state?.sessions ?? {})) {
					if (session.state) lane.sessionStates.set(taskId, session.state);
				}
				const seed = lane.sessionStates.get(lane.seedTaskId);
				if (seed && TERMINAL_STATES.has(seed) && lane.terminalState === null) lane.terminalState = seed;
				const running = [...lane.sessionStates.values()].filter((s) => s === "running").length;
				const reviewing = [...lane.sessionStates.values()].filter((s) => s === "awaiting_review").length;
				const lastTool = [...lane.messages].reverse().find((message) => message.toolName)?.toolName ?? "—";
				const seedDone = seed && TERMINAL_STATES.has(seed);
				if (!seedDone) allTerminal = false;
				rows.push(
					`  ${lane.label.padEnd(14)} cards=${String(lane.cardCount).padStart(2)} ` +
						`seed=${(seed ?? "starting").padEnd(14)} running=${running} review=${reviewing} ` +
						`msgs=${String(lane.messages.length).padStart(4)} last_tool=${lastTool}`,
				);
			}
			log(`[${new Date().toLocaleTimeString()}] task flow:`);
			for (const row of rows) log(row);
			log();
			if (allTerminal) {
				log("All seed cards reached a terminal state.\n");
				break;
			}
		}

		// ── Evidence report (success AND failure) — the harvest that feeds todo.md. ──
		log("════════════════════ DEV-TEST RAIL EVIDENCE ════════════════════");
		for (const lane of lanes) {
			const toolNames = lane.messages.filter((message) => message.toolName).map((message) => message.toolName as string);
			const perTool = new Map<string, number>();
			for (const name of toolNames) perTool.set(name, (perTool.get(name) ?? 0) + 1);
			const decomposed = toolNames.includes("decompose_project") || lane.cardCount > 1;
			const narrationLeaks = lane.messages.filter((message) => message.role === "assistant" && NARRATION_MARKERS.test(message.content)).length;
			const repeats = new Map<string, number>();
			for (const message of lane.messages) {
				if (message.toolName) {
					const key = `${message.toolName}:${message.content}`;
					repeats.set(key, (repeats.get(key) ?? 0) + 1);
				}
			}
			const hotRepeats = [...repeats.values()].filter((count) => count > 2).length;
			const reachedReview = [...lane.sessionStates.values()].some((s) => s === "awaiting_review");
			const verdict = !lane.startedOk
				? "❌ FAILED TO START"
				: lane.terminalState === "awaiting_review" || reachedReview
					? "✅ delivered (awaiting_review)"
					: lane.terminalState === "failed"
						? "❌ failed"
						: "⚠️ non-terminal in window";
			log("");
			log(`■ ${lane.label}  →  ${verdict}`);
			log(`    start: ${lane.startedOk ? "ok" : `FAILED(${lane.startError})`}   cards: ${lane.cardCount}   decomposed: ${decomposed ? "yes" : "no"}   WS frames: ${lane.frames}`);
			log(`    session states: ${JSON.stringify(Object.fromEntries([...lane.sessionStates].map(([id, s]) => [id.slice(0, 8), s])))}`);
			log(`    tool calls (${toolNames.length}): ${[...perTool.entries()].map(([n, c]) => `${n}×${c}`).join(", ") || "(none)"}`);
			log(`    anomalies: narration-leaks=${narrationLeaks}${narrationLeaks ? " ⚠️" : ""}  hot-repeats=${hotRepeats}${hotRepeats ? " ⚠️" : ""}`);
		}
		const delivered = lanes.filter((lane) => lane.terminalState === "awaiting_review" || [...lane.sessionStates.values()].includes("awaiting_review")).length;
		const anomalies = lanes.filter(
			(lane) => lane.messages.some((m) => m.role === "assistant" && NARRATION_MARKERS.test(m.content)),
		).length;
		log("");
		log(`SUMMARY: ${delivered}/${lanes.length} delivered to review · ${anomalies} project(s) with narration anomalies · model ${model}`);
		log("(Anomalies / non-terminal / failed-to-start cases are the evidence to fold into todo.md as §5.O/§5.AI items.)");
	} finally {
		log("\nrestoring model + concurrency + removing throwaway projects…");
		await cleanup();
		log("done.");
	}
	process.exit(0);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
