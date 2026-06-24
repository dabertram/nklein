/**
 * §5.O small-model output-capture harness. Drives one dev-test scenario on a pinned local model and **subscribes to
 * the runtime's live activity stream** (the `/api/runtime/ws` feed the web-ui uses), recording every `task_chat_message`
 * the agent emits — then catalogs the small model's OUTPUT behavior: the tool-call sequence, any narrated-tool-call
 * markup that leaked into content, repeated identical tool calls, and the terminal session state. This is the lens
 * Round 0–4 concluded §5.O needs (the board classifier + `latestHookActivity` polling can't surface per-call output).
 *
 * Requires a runtime already running on port 3484 with NODE_ENV=development (i.e. `npm run dev:full`) and a live LM
 * Studio. It pins the model via the provider settings, runs, then **restores the original model + removes the
 * throwaway dev-test project** so it leaves no trace.
 *
 * Run:  tsx scripts/sweep-capture.mts --model google/gemma-4-e2b-m5max --preset complex_dag
 */
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { resolveNKleinDevTestProjectScenario } from "../src/nklein-sdk/nklein-dev-test-project";
import type { RuntimeAppRouter } from "../src/trpc/app-router";

const URL_BASE = process.env.NKLEIN_VERIFY_BASE_URL?.trim() || "http://127.0.0.1:3484";
const TRPC_URL = `${URL_BASE}/api/trpc`;

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

const MODEL = arg("model", "google/gemma-4-e2b-m5max");
const PRESET = arg("preset", "complex_dag");
const MAX_WAIT_MS = Number.parseInt(arg("max-wait-ms", "420000"), 10);

const NARRATION_MARKERS = /<\|?\s*(?:tool_call|function_call|python_tag)\s*\|?>|\[TOOL_CALLS\]|<function\s*=/i;

interface CapturedMessage {
	role: string;
	toolName: string | null;
	hookEventName: string | null;
	content: string;
}

function log(line: string): void {
	process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
	const base = createTRPCProxyClient<RuntimeAppRouter>({ links: [httpBatchLink({ url: TRPC_URL })] });

	// Capture + pin the model.
	const before = await base.runtime.getConfig.query();
	const original = before.nkleinProviderSettings;
	log(`Pinning model: ${MODEL} (was ${original.modelId ?? "none"})  preset: ${PRESET}`);
	await base.runtime.saveNKleinProviderSettings.mutate({
		providerId: "lmstudio",
		modelId: MODEL,
		baseUrl: "http://127.0.0.1:1234/v1",
	});

	// Restore the original model if anything below fails before the normal end-of-run restore.
	const restoreModel = () =>
		base.runtime.saveNKleinProviderSettings
			.mutate({ providerId: "lmstudio", modelId: original.modelId, baseUrl: original.baseUrl })
			.catch(() => undefined);

	let created: Awaited<ReturnType<typeof base.projects.createDevTestProject.mutate>>;
	try {
		created = await base.projects.createDevTestProject.mutate({
			preset: PRESET as Parameters<typeof resolveNKleinDevTestProjectScenario>[0],
		});
	} catch (error) {
		await restoreModel();
		throw error;
	}
	if (!created.ok || !created.project || !created.task) {
		await restoreModel();
		throw new Error(`createDevTestProject failed: ${(created as { error?: string }).error ?? "unknown"}`);
	}
	const workspaceId = created.project.id;
	const seedTaskId = created.task.id;
	const ws = createTRPCProxyClient<RuntimeAppRouter>({
		links: [httpBatchLink({ url: TRPC_URL, headers: () => ({ "x-nklein-workspace-id": workspaceId }) })],
	});
	log(`Project: ${workspaceId}\nSeed: ${seedTaskId}`);

	const captured: CapturedMessage[] = [];
	let frames = 0;
	let snapshotSeen = false;
	const wsUrl = `${URL_BASE.replace(/^http/, "ws")}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`;
	const socket = new WebSocket(wsUrl);
	socket.addEventListener("message", (event) => {
		frames += 1;
		try {
			// The runtime-state-hub broadcasts FLAT frames: { type, workspaceId, taskId, message }.
			const frame = JSON.parse(String(event.data)) as {
				type?: string;
				taskId?: string;
				message?: { role?: string; content?: string; meta?: { toolName?: string | null; hookEventName?: string | null } };
			};
			if (frame.type === "snapshot") {
				snapshotSeen = true;
			}
			if (frame.type === "task_chat_message" && frame.taskId === seedTaskId) {
				const message = frame.message ?? {};
				captured.push({
					role: message.role ?? "?",
					toolName: message.meta?.toolName ?? null,
					hookEventName: message.meta?.hookEventName ?? null,
					content: message.content ?? "",
				});
			}
		} catch {
			// ignore non-JSON / unrelated frames
		}
	});
	await new Promise<void>((resolve) => {
		socket.addEventListener("open", () => resolve());
		socket.addEventListener("error", () => resolve());
	});

	const scenario = resolveNKleinDevTestProjectScenario(PRESET as Parameters<typeof resolveNKleinDevTestProjectScenario>[0]);
	const started = await ws.runtime.startTaskSession.mutate({
		taskId: seedTaskId,
		prompt: scenario.prompt,
		taskTitle: scenario.title,
		baseRef: "main",
		agentId: "nklein",
		startInPlanMode: false,
	});
	log(`Start: ok=${started.ok}${started.error ? ` error=${started.error}` : ""}`);

	const deadline = Date.now() + MAX_WAIT_MS;
	let terminalState: string | null = null;
	if (started.ok) {
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5000));
			const state = (await ws.workspace.getState.query().catch(() => null)) as {
				sessions?: Record<string, { state?: string }>;
			} | null;
			const session = state?.sessions?.[seedTaskId];
			if (session?.state && ["awaiting_review", "completed", "failed"].includes(session.state)) {
				terminalState = session.state;
				break;
			}
		}
	}
	socket.close();
	await base.runtime.saveNKleinProviderSettings.mutate({
		providerId: "lmstudio",
		modelId: original.modelId,
		baseUrl: original.baseUrl,
	});
	// Remove the throwaway project, retrying — the registry remove occasionally races a concurrent state write.
	for (let attempt = 0; attempt < 4; attempt += 1) {
		await base.projects.remove.mutate({ projectId: workspaceId }).catch(() => undefined);
		const stillThere = (await base.projects.list.query().catch(() => ({ projects: [] }))).projects.some(
			(project) => project.id === workspaceId,
		);
		if (!stillThere) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 800));
	}

	// Catalog.
	const toolCalls = captured.filter((message) => message.toolName).map((message) => message.toolName as string);
	// A real *leak* is narration markup surviving into a user-facing `assistant` message. Narration in the
	// `reasoning` channel is internal + handled by `recoverNarratedToolCalls` (so reasoning models like qwen3 that
	// "think" `<tool_call>{…}` are fine) — tracked separately as informational, not a leak.
	const narrationLeaks = captured.filter(
		(message) => message.role === "assistant" && NARRATION_MARKERS.test(message.content),
	);
	const reasoningNarration = captured.filter(
		(message) => message.role === "reasoning" && NARRATION_MARKERS.test(message.content),
	).length;
	// Repeat detection uses the FULL tool message content, so a *stateful advancing* tool (e.g. update_focus_chain,
	// whose chain progresses) isn't mistaken for a loop — only genuinely identical re-emits count (matches the
	// full-input-fingerprint guard's semantics).
	const repeated = new Map<string, number>();
	for (const message of captured) {
		if (message.toolName) {
			const key = `${message.toolName}:${message.content}`;
			repeated.set(key, (repeated.get(key) ?? 0) + 1);
		}
	}
	const repeatedHot = [...repeated.entries()].filter(([, count]) => count > 2);
	// Also tally per-tool call counts to see which tools the model leaned on / spun on.
	const perTool = new Map<string, number>();
	for (const name of toolCalls) {
		perTool.set(name, (perTool.get(name) ?? 0) + 1);
	}

	log("");
	log(`=== §5.O capture: ${MODEL} on ${PRESET} ===`);
	log(`WS frames received:         ${frames} (snapshot seen: ${snapshotSeen})`);
	log(`Terminal session state:     ${terminalState ?? "(not reached within max-wait)"}`);
	log(`Messages captured:          ${captured.length}`);
	log(`Tool calls (${toolCalls.length}):            ${[...perTool.entries()].map(([n, c]) => `${n}×${c}`).join(", ") || "(none)"}`);
	log(`Narration leaks (assistant): ${narrationLeaks.length}${narrationLeaks.length ? " ⚠️" : " ✓"}`);
	for (const leak of narrationLeaks.slice(0, 5)) {
		log(`  - [${leak.role}] ${leak.content.replace(/\n/g, " ").slice(0, 120)}`);
	}
	log(`Reasoning-channel narration: ${reasoningNarration} (internal; handled by recoverNarratedToolCalls)`);
	log(`Hot repeated tool calls:    ${repeatedHot.length}${repeatedHot.length ? " ⚠️" : " ✓"}`);
	for (const [key, count] of repeatedHot.slice(0, 5)) {
		log(`  - ${count}× ${key.slice(0, 100)}`);
	}
	log("");
	log("Role tally: " + JSON.stringify(captured.reduce<Record<string, number>>((acc, m) => {
		acc[m.role] = (acc[m.role] ?? 0) + 1;
		return acc;
	}, {})));
	process.exit(0);
}

main().catch((error) => {
	log(`FATAL: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
	process.exit(2);
});
