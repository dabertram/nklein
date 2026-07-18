/**
 * F12.106 external-trigger intake — the EFFECTFUL half behind `POST /api/triggers/<name>`.
 *
 * Resolves the named template from a registered workspace's `.nklein/triggers/<name>.json`, renders the card
 * (pure core), seeds it onto the board (front of Ready for incident-style templates), and leaves an auditable
 * trail: one self-observation + one ledger transition per fire. The runtime-server route enforces the
 * LOCAL-ONLY invariant (loopback callers only) before this handler runs; deps are injected so the whole flow is
 * testable without an HTTP server.
 *
 * Auto-start is the board's own machinery, not a special path: the seeded card is dependency-free in a swept
 * lane, and warming the workspace's scoped service arms the board-liveness watchdog whose ready-sweep starts it.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addTaskToColumn } from "../core/task-board-mutations";
import {
	isSafeTriggerName,
	parseTriggerPayload,
	renderTriggerCard,
	TRIGGER_COOLDOWN_MS,
	type TriggerCardTemplate,
	triggerCardTemplateSchema,
} from "../core/trigger-intake";

export interface TriggerWorkspaceEntry {
	workspaceId: string;
	repoPath: string;
}

export interface TriggerIntakeDeps {
	listWorkspaces(): Promise<TriggerWorkspaceEntry[]>;
	/** Raw template file content, or null when the workspace does not define the trigger. */
	readTemplateFile(repoPath: string, name: string): Promise<string | null>;
	seedCard(input: {
		entry: TriggerWorkspaceEntry;
		template: TriggerCardTemplate;
		card: { taskId: string; title: string; prompt: string };
	}): Promise<void>;
	/** Best-effort audit + watchdog warm-up; must never throw. */
	audit(input: {
		entry: TriggerWorkspaceEntry;
		triggerName: string;
		taskId: string;
		payloadBytes: number;
	}): Promise<void>;
	now(): number;
	randomUuid(): string;
}

export interface TriggerIntakeResult {
	status: number;
	body: Record<string, unknown>;
}

const lastFiredAtByKey = new Map<string, number>();

/** Test seam: clear the alarm-storm damping state. */
export function resetTriggerCooldowns(): void {
	lastFiredAtByKey.clear();
}

/** Read + validate a workspace's template file; distinguishes "absent" (null) from "present but invalid" (throw). */
export async function loadTriggerTemplateFile(repoPath: string, name: string): Promise<string | null> {
	try {
		return await readFile(join(repoPath, ".nklein", "triggers", `${name}.json`), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

export async function handleTriggerIntake(
	input: { name: string; bodyText: string; workspaceIdParam: string | null },
	deps: TriggerIntakeDeps,
): Promise<TriggerIntakeResult> {
	if (!isSafeTriggerName(input.name)) {
		return {
			status: 400,
			body: { error: "Invalid trigger name (lowercase letters, digits, '-' and '_' only, max 64 chars)." },
		};
	}
	const parsed = parseTriggerPayload(input.bodyText);
	if (!parsed.ok) {
		return { status: 400, body: { error: parsed.reason } };
	}

	// Resolve the template across registered workspaces (or the one explicitly named).
	const workspaces = await deps.listWorkspaces();
	const candidates: Array<{ entry: TriggerWorkspaceEntry; raw: string }> = [];
	for (const entry of workspaces) {
		if (input.workspaceIdParam && entry.workspaceId !== input.workspaceIdParam) {
			continue;
		}
		const raw = await deps.readTemplateFile(entry.repoPath, input.name).catch(() => null);
		if (raw !== null) {
			candidates.push({ entry, raw });
		}
	}
	if (candidates.length === 0) {
		return {
			status: 404,
			body: {
				error: input.workspaceIdParam
					? `Workspace "${input.workspaceIdParam}" does not define trigger "${input.name}" (.nklein/triggers/${input.name}.json).`
					: `No registered workspace defines trigger "${input.name}" (.nklein/triggers/${input.name}.json).`,
			},
		};
	}
	if (candidates.length > 1) {
		return {
			status: 409,
			body: {
				error: `Trigger "${input.name}" is defined in ${candidates.length} workspaces — disambiguate with ?workspaceId=…`,
				workspaceIds: candidates.map((candidate) => candidate.entry.workspaceId),
			},
		};
	}
	const chosen = candidates[0];
	if (!chosen) {
		return { status: 500, body: { error: "Internal error resolving trigger workspace." } };
	}

	let template: TriggerCardTemplate;
	try {
		template = triggerCardTemplateSchema.parse(JSON.parse(chosen.raw));
	} catch (error) {
		return {
			status: 422,
			body: {
				error: `Template .nklein/triggers/${input.name}.json is invalid: ${error instanceof Error ? error.message.slice(0, 400) : String(error)}`,
			},
		};
	}

	// Alarm-storm damping: one fire per (workspace, trigger) per cooldown window.
	const cooldownKey = `${chosen.entry.workspaceId}:${input.name}`;
	const now = deps.now();
	const lastFiredAt = lastFiredAtByKey.get(cooldownKey);
	if (lastFiredAt !== undefined && now - lastFiredAt < TRIGGER_COOLDOWN_MS) {
		return {
			status: 429,
			body: {
				error: `Trigger "${input.name}" fired ${Math.round((now - lastFiredAt) / 1000)}s ago — damped to one fire per ${TRIGGER_COOLDOWN_MS / 1000}s per workspace.`,
				retryAfterSeconds: Math.ceil((TRIGGER_COOLDOWN_MS - (now - lastFiredAt)) / 1000),
			},
		};
	}
	lastFiredAtByKey.set(cooldownKey, now);

	const card = renderTriggerCard({
		triggerName: input.name,
		template,
		payload: parsed.payload,
		now,
		uniqueSuffix: deps.randomUuid().slice(0, 8),
	});
	try {
		await deps.seedCard({ entry: chosen.entry, template, card });
	} catch (error) {
		// The fire did not seed — release the cooldown so a corrected retry is not damped.
		lastFiredAtByKey.delete(cooldownKey);
		return {
			status: 500,
			body: {
				error: `Failed to seed card: ${error instanceof Error ? error.message.slice(0, 400) : String(error)}`,
			},
		};
	}
	await deps
		.audit({
			entry: chosen.entry,
			triggerName: input.name,
			taskId: card.taskId,
			payloadBytes: Buffer.byteLength(input.bodyText.trim(), "utf8"),
		})
		.catch(() => undefined);
	return {
		status: 201,
		body: {
			ok: true,
			taskId: card.taskId,
			workspaceId: chosen.entry.workspaceId,
			lane: template.lane,
			front: template.front,
		},
	};
}

/** The board mutation the runtime-server injects as `seedCard`: append via the normal card path, then front it. */
export function applyTriggerCardToBoard(input: {
	board: Parameters<typeof addTaskToColumn>[0];
	template: TriggerCardTemplate;
	card: { taskId: string; title: string; prompt: string };
	randomUuid: () => string;
	now: number;
}): ReturnType<typeof addTaskToColumn> {
	const result = addTaskToColumn(
		input.board,
		input.template.lane,
		{
			taskId: input.card.taskId,
			title: input.card.title,
			prompt: input.card.prompt,
			baseRef: input.template.baseRef,
			startInPlanMode: input.template.startInPlanMode,
			...(input.template.agentId ? { agentId: input.template.agentId } : {}),
			...(input.template.filesLikelyTouched.length > 0
				? { filesLikelyTouched: input.template.filesLikelyTouched }
				: {}),
		},
		input.randomUuid,
		input.now,
	);
	if (input.template.front) {
		const column = result.board.columns.find((candidate) => candidate.id === input.template.lane);
		if (column) {
			const index = column.cards.findIndex((candidate) => candidate.id === input.card.taskId);
			if (index > 0) {
				const [seeded] = column.cards.splice(index, 1);
				if (seeded) {
					column.cards.unshift(seeded);
				}
			}
		}
	}
	return result;
}
