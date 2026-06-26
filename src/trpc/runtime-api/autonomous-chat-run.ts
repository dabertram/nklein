import type { ChatService } from "../../chat/chat-service";
import type {
	RuntimeChatAutonomousRunStatus,
	RuntimeChatAutonomousStatusRequest,
	RuntimeChatStartAutonomousRequest,
	RuntimeChatStartAutonomousResponse,
	RuntimeSwarmGuardrails,
} from "../../core/api-contract";

/**
 * Background driver + status registry for autonomous chat runs (todo §5.0.1), extracted as a focused runtime-api
 * controller. `start` kicks off `chatService.runAutonomous` in the background (a run is many turns × model calls, so
 * it can't block the request) bounded by the swarm-guardrail budget, recording a per-session status; `status` reads
 * it. The run's turns persist to the transcript as they go, so the existing chat UI shows progress; this registry adds
 * the run-level lifecycle (running? final stop reason / turns / plan progress). One run per session at a time.
 */
export interface AutonomousChatRunController {
	start: (input: RuntimeChatStartAutonomousRequest) => Promise<RuntimeChatStartAutonomousResponse>;
	status: (input: RuntimeChatAutonomousStatusRequest) => RuntimeChatAutonomousRunStatus;
}

function idleStatus(goal: string | null): RuntimeChatAutonomousRunStatus {
	return { running: false, goal, stopReason: null, turns: 0, finalText: null, planProgress: { total: 0, done: 0 } };
}

export function createAutonomousChatRunController(deps: {
	chatService: Pick<ChatService, "runAutonomous">;
	/** Resolves the swarm-guardrail budget per run (live: the global runtime config's `swarmGuardrails`). */
	resolveGuardrails: () => Promise<RuntimeSwarmGuardrails>;
}): AutonomousChatRunController {
	const runsBySession = new Map<string, RuntimeChatAutonomousRunStatus>();

	return {
		start: async (input) => {
			const existing = runsBySession.get(input.sessionId);
			if (existing?.running) {
				// One run per session — return the in-flight status unchanged rather than starting a second.
				return { started: false, status: existing };
			}
			const guardrails = await deps.resolveGuardrails();
			const budget = {
				maxTurns: guardrails.maxAutonomousTurnsPerTask,
				maxWallTimeMs: guardrails.maxAutonomousWallTimeMs,
				maxNoProgressTurns: guardrails.maxRepeatedNoDiffCheckpoints,
			};
			const runningStatus: RuntimeChatAutonomousRunStatus = {
				running: true,
				goal: input.goal,
				stopReason: null,
				turns: 0,
				finalText: null,
				planProgress: { total: 0, done: 0 },
			};
			runsBySession.set(input.sessionId, runningStatus);
			void deps.chatService
				.runAutonomous({ sessionId: input.sessionId, goal: input.goal, budget })
				.then((result) => {
					runsBySession.set(
						input.sessionId,
						result
							? {
									running: false,
									goal: input.goal,
									stopReason: result.stopReason,
									turns: result.turns,
									finalText: result.finalText,
									planProgress: result.planProgress,
								}
							: idleStatus(input.goal),
					);
				})
				.catch((error) => {
					// stopReason stays null (no clean driver stop); the failure surfaces in finalText.
					runsBySession.set(input.sessionId, {
						running: false,
						goal: input.goal,
						stopReason: null,
						turns: 0,
						finalText: `Autonomous run failed: ${error instanceof Error ? error.message : String(error)}`,
						planProgress: { total: 0, done: 0 },
					});
				});
			return { started: true, status: runningStatus };
		},
		status: (input) => runsBySession.get(input.sessionId) ?? idleStatus(null),
	};
}
