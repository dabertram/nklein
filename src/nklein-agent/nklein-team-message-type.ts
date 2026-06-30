/**
 * Team coordination message-type discriminants, integrated from the formerly-vendored SDK
 * (`@nklein/shared` ⇐ Cline's `@clinebot/shared`). These string values are the discriminants of the
 * team-event stream (`TeamEvent`, surfaced via `sdk-runtime-boundary`). Kept as a named enum so
 * call sites and tests reference stable constants instead of bare string literals.
 */
export enum TeamMessageType {
	TaskStart = "task_start",
	TaskEnd = "task_end",
	AgentEvent = "agent_event",
	TeammateSpawned = "teammate_spawned",
	TeammateShutdown = "teammate_shutdown",
	TeamTaskUpdated = "team_task_updated",
	TeamMessage = "team_message",
	TeamMissionLog = "team_mission_log",
	TeamTaskCompleted = "team_task_completed",
	RunStarted = "run_started",
	RunQueued = "run_queued",
	RunProgress = "run_progress",
	RunCompleted = "run_completed",
	RunFailed = "run_failed",
	RunCancelled = "run_cancelled",
	RunInterrupted = "run_interrupted",
	OutcomeCreated = "outcome_created",
	OutcomeFragmentAttached = "outcome_fragment_attached",
	OutcomeFragmentReviewed = "outcome_fragment_reviewed",
	OutcomeFinalized = "outcome_finalized",
}
