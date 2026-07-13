import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	applyFocusChainStepTiming,
	type FocusChain,
	normalizeFocusChain,
	repairFocusChainRegression,
	summarizeFocusChain,
} from "../core/focus-chain";
import type { LocalLlmToolDefinition } from "../nklein-agent/nklein-local-llm-client";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatTool } from "./chat-tool-executor";

/**
 * Per-session focus chain for the chat agent (todo §5.M G4 + §5.N): the agent-authored ordered checklist it drafts
 * and works through, keeping a small local model on-task across a long conversation. Reuses the pure core
 * (`src/core/focus-chain.ts`) for the shape + normalization + prompt projection; this owns the per-session
 * persistence and the `update_focus_chain` tool. Unlike the transcript (append-only log), the focus chain is a
 * single current state, so each session is one JSON file overwritten on update.
 *
 * `update_focus_chain` is a `sandbox_read` action: it's a benign internal control-plane note that changes nothing
 * in the user's files or sandbox, so the execution-mode gate always allows it (no host/board mutation).
 */

export interface ChatFocusChainStoreOptions {
	rootDir?: string;
}

const DEFAULT_ROOT = join(resolveNkleinRuntimeHomePath(homedir()), "chat-focus-chains");

/** One file per session, keyed by a hash of the session id so any id is a safe, fixed-length filename. */
function resolveFocusChainPath(sessionId: string, rootDir?: string): string {
	const fileName = `${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.json`;
	return join(rootDir ?? DEFAULT_ROOT, fileName);
}

/** Read the session's current focus chain, or null when none has been written (or the file is unreadable/corrupt). */
export async function readChatFocusChain(
	sessionId: string,
	options: ChatFocusChainStoreOptions = {},
): Promise<FocusChain | null> {
	try {
		const raw = await readFile(resolveFocusChainPath(sessionId, options.rootDir), "utf8");
		const parsed = JSON.parse(raw) as { steps?: unknown; updatedAt?: unknown };
		const rawSteps = Array.isArray(parsed.steps)
			? (parsed.steps as Array<{ text?: unknown; status?: unknown; startedAt?: unknown; completedAt?: unknown }>)
			: null;
		// Re-normalize on read so a hand-edited/old file can't inject an invalid shape.
		const normalized = normalizeFocusChain(
			rawSteps,
			typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
		);
		if (!normalized) {
			return null;
		}
		// Normalization strips the per-step timestamps (it only knows text+status), so re-attach the persisted
		// timing by step text — otherwise the §5.N timing carry would reset on every disk round-trip.
		const timingByText = new Map<string, { startedAt?: number; completedAt?: number }>();
		for (const step of rawSteps ?? []) {
			if (typeof step?.text === "string") {
				timingByText.set(step.text.trim(), {
					...(typeof step.startedAt === "number" ? { startedAt: step.startedAt } : {}),
					...(typeof step.completedAt === "number" ? { completedAt: step.completedAt } : {}),
				});
			}
		}
		return {
			...normalized,
			steps: normalized.steps.map((step) => ({ ...step, ...(timingByText.get(step.text) ?? {}) })),
		};
	} catch {
		return null;
	}
}

/** Overwrite the session's focus chain. */
export async function writeChatFocusChain(
	sessionId: string,
	chain: FocusChain,
	options: ChatFocusChainStoreOptions = {},
): Promise<void> {
	const root = options.rootDir ?? DEFAULT_ROOT;
	await mkdir(root, { recursive: true });
	await writeFile(resolveFocusChainPath(sessionId, options.rootDir), `${JSON.stringify(chain, null, 2)}\n`, "utf8");
}

export interface FocusChainToolDeps {
	read: (sessionId: string) => Promise<FocusChain | null>;
	write: (sessionId: string, chain: FocusChain) => Promise<void>;
}

/**
 * Build the `update_focus_chain` tool for a chat session. The agent re-emits the WHOLE checklist (text + status)
 * each time — the most reliable shape for small models — and we normalize + carry per-step timing from the prior
 * chain, then persist. Returns a compact progress confirmation.
 */
export function createFocusChainTools(
	sessionId: string,
	options: { deps?: FocusChainToolDeps; now?: () => number } = {},
): ChatToolSet {
	const deps = options.deps ?? {
		read: (id) => readChatFocusChain(id),
		write: (id, chain) => writeChatFocusChain(id, chain),
	};
	const now = options.now ?? Date.now;

	const tools: ChatTool[] = [
		{
			name: "update_focus_chain",
			actionKind: "sandbox_read",
			run: async (args) => {
				const rawSteps = Array.isArray(args.steps)
					? (args.steps as Array<{ text?: unknown; status?: unknown }>)
					: null;
				const normalized = normalizeFocusChain(rawSteps, now());
				if (!normalized) {
					return "Provide `steps`: a non-empty array of { text, status } items (status ∈ pending|in_progress|done|skipped).";
				}
				const prior = await deps.read(sessionId);
				// F1.5 repair guard: an accidental wholesale reset keeps the prior chain and tells the model why.
				const verdict = repairFocusChainRegression(prior, normalized);
				if (verdict.repaired) {
					return `Focus chain update rejected: ${verdict.reason ?? "it would have destroyed recorded progress."}`;
				}
				const next = applyFocusChainStepTiming(prior, normalized, now());
				await deps.write(sessionId, next);
				const summary = summarizeFocusChain(next);
				const inProgress = summary.inProgress > 0 ? `, ${summary.inProgress} in progress` : "";
				return `Focus chain updated: ${summary.done}/${summary.total} done${inProgress}.`;
			},
		},
	];

	const definitions: LocalLlmToolDefinition[] = [
		{
			name: "update_focus_chain",
			description:
				"Record or update your focus chain — the ordered checklist of steps for this task. Re-send the WHOLE list each time with each step's current status. Use it to plan your approach and track progress so you stay on task.",
			parameters: {
				type: "object",
				properties: {
					steps: {
						type: "array",
						description: "The full ordered checklist; re-send every step each update.",
						items: {
							type: "object",
							properties: {
								text: { type: "string", description: "What this step does." },
								status: {
									type: "string",
									enum: ["pending", "in_progress", "done", "skipped"],
									description: "This step's current status.",
								},
							},
							required: ["text", "status"],
						},
					},
				},
				required: ["steps"],
			},
		},
	];

	return { tools, definitions };
}

/**
 * F1.6 — the OPERATOR edit path for a chat session's focus chain (the plan-strip controls): the same normalize +
 * destructive-re-emit guard as the agent tool, so a UI edit can never corrupt the chain either. An empty `steps`
 * list from the operator CLEARS the chain deliberately (unlike an agent re-emit, an explicit operator clear is an
 * intentional act) — every other regression is rejected with the guard's reason.
 */
export async function applyOperatorChatFocusChainUpdate(
	sessionId: string,
	steps: ReadonlyArray<{ text?: unknown; status?: unknown }>,
	options: ChatFocusChainStoreOptions & { now?: () => number } = {},
): Promise<{ ok: boolean; rejected: string | null; chain: FocusChain | null }> {
	const now = options.now ?? Date.now;
	const prior = await readChatFocusChain(sessionId, options);
	if (steps.length === 0) {
		const cleared: FocusChain = { steps: [], updatedAt: now() };
		await writeChatFocusChain(sessionId, cleared, options);
		return { ok: true, rejected: null, chain: null };
	}
	const normalized = normalizeFocusChain([...steps], now());
	if (!normalized) {
		return { ok: false, rejected: "No valid steps were provided.", chain: prior };
	}
	const verdict = repairFocusChainRegression(prior, normalized);
	if (verdict.repaired) {
		return { ok: false, rejected: verdict.reason, chain: prior };
	}
	const next = applyFocusChainStepTiming(prior, normalized, now());
	await writeChatFocusChain(sessionId, next, options);
	return { ok: true, rejected: null, chain: next };
}
