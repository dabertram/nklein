/**
 * P17.2 slice 2 — the ACP ports bound to a LIVE runtime's external-ingress facade (the same closures the A2A
 * receive-side uses, in-process). A prompt turn is A2A-symmetric on purpose: seed a ready-lane card, arm the
 * board machinery, then POLL the board record + status note and stream every TRANSITION as an
 * agent_message_chunk until the card reaches a terminal shape.
 *
 * Cancellation stops BOTH halves: the turn resolves "cancelled" immediately, and the seeded card's live
 * session is stopped through the facade so an editor's cancel never leaves the swarm running the turn's card.
 */

import type { RuntimeServer } from "../server/runtime-server";
import type { NKleinAcpPorts } from "./nklein-acp-agent";

type IngressEntry = { workspaceId: string; repoPath: string };

const POLL_MS = 1_000;
/** A prompt turn that outlives this bound is a wedged drain, not a slow one — resolve rather than hang the editor. */
const TURN_CEILING_MS = 30 * 60 * 1_000;

export function buildRuntimeAcpPorts(input: {
	readonly ingress: RuntimeServer["externalIngress"];
	/** Register a repo path as a workspace when it is not already one (the cli's workspace registry). */
	readonly registerWorkspacePath: (path: string) => Promise<{ workspaceId: string; repoPath: string }>;
	readonly randomUuid: () => string;
	readonly now?: () => number;
}): NKleinAcpPorts {
	const now = input.now ?? Date.now;
	const entriesByWorkspaceId = new Map<string, IngressEntry>();

	return {
		randomUuid: input.randomUuid,
		ensureWorkspace: async (cwd) => {
			const existing = (await input.ingress.listWorkspaces()).find((entry) => entry.repoPath === cwd);
			const entry = existing ?? (await input.registerWorkspacePath(cwd));
			entriesByWorkspaceId.set(entry.workspaceId, entry);
			return entry.workspaceId;
		},
		runPrompt: async ({ workspaceId, promptText, emitUpdate, signal }) => {
			const entry = entriesByWorkspaceId.get(workspaceId);
			if (!entry) {
				throw new Error(`ACP workspace ${workspaceId} is not bound.`);
			}
			const taskId = `acp-${input.randomUuid()}`;
			const title = promptText.split("\n")[0]?.slice(0, 96) || "ACP task";
			await input.ingress.seedCard(entry, { taskId, title, prompt: promptText });
			await input.ingress.armWorkspace(entry);
			const emitText = (text: string) =>
				emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
			await emitText(`Seeded board card ${taskId} — the swarm is on it.`);

			let lastLane: string | null = null;
			let lastReview: string | null = null;
			let lastNote: string | null = null;
			const deadline = now() + TURN_CEILING_MS;
			while (!signal.aborted && now() < deadline) {
				const record = await input.ingress.readBoardRecord(entry, taskId).catch(() => null);
				if (record) {
					if (record.columnId !== lastLane) {
						lastLane = record.columnId;
						await emitText(`Lane: ${record.columnId}`);
					}
					if ((record.reviewStatus ?? null) !== lastReview) {
						lastReview = record.reviewStatus ?? null;
						if (lastReview) {
							await emitText(
								`Review: ${lastReview}${record.reviewParkedReason ? ` (${record.reviewParkedReason})` : ""}`,
							);
						}
					}
					const note = await input.ingress.readStatusNote?.(entry, taskId).catch(() => null);
					if (note && note !== lastNote) {
						lastNote = note;
						await emitText(note);
					}
					if (record.columnId === "completed") {
						await emitText(`Card ${taskId} completed.`);
						return "end_turn";
					}
					if (record.columnId === "trash") {
						await emitText(`Card ${taskId} was trashed.`);
						return "refusal";
					}
					// A parked review is the swarm handing the card to the HUMAN — the turn is over for the editor.
					if (record.columnId === "review" && record.reviewParkedReason) {
						await emitText(`Card ${taskId} is parked for the operator: ${record.reviewParkedReason}`);
						return "end_turn";
					}
				}
				await new Promise((tick) => setTimeout(tick, POLL_MS));
			}
			if (signal.aborted) {
				// The editor cancelled: stop the card's live session too — never leave the swarm running a
				// turn the client walked away from. Best-effort; the turn's contract is resolving promptly.
				void input.ingress.stopTask(entry, taskId).catch(() => undefined);
				return "cancelled";
			}
			return "max_turn_requests";
		},
	};
}
