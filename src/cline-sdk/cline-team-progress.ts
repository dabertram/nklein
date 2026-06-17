import type { RuntimeClineTeamProgressEvent } from "../core/api-contract";
import type { ClineSdkTeamEvent } from "./sdk-runtime-boundary";

const MAX_TEAM_PROGRESS_MESSAGE_LENGTH = 180;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
	const value = record?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function compactText(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= MAX_TEAM_PROGRESS_MESSAGE_LENGTH) {
		return collapsed;
	}
	return `${collapsed.slice(0, MAX_TEAM_PROGRESS_MESSAGE_LENGTH - 1).trimEnd()}...`;
}

function agentLabel(agentId: string | null): string {
	return agentId ? `Agent ${agentId}` : "Teammate";
}

function readRunId(run: Record<string, unknown> | null): string | null {
	return readString(run, "id") ?? readString(run, "runId") ?? readString(run, "taskId");
}

function readRunStatus(run: Record<string, unknown> | null): string | null {
	return readString(run, "status") ?? readString(run, "state");
}

function readTaskTitle(task: Record<string, unknown> | null): string | null {
	return readString(task, "title") ?? readString(task, "description") ?? readString(task, "message");
}

function summarizeTeamEvent(record: Record<string, unknown>, eventType: string, agentId: string | null): string {
	const run = asRecord(record.run);
	const task = asRecord(record.task);
	const mailboxMessage = asRecord(record.message);
	const missionEntry = asRecord(record.entry);
	const outcome = asRecord(record.outcome);
	const fragment = asRecord(record.fragment);
	const teammate = asRecord(record.teammate);
	const reason = readString(record, "reason");
	const directMessage = readString(record, "message");
	const error = asRecord(record.error);
	const errorMessage = readString(error, "message");
	const runId = readRunId(run);
	const runStatus = readRunStatus(run);

	switch (eventType) {
		case "task_start":
			return compactText(directMessage ?? `${agentLabel(agentId)} started delegated work.`);
		case "task_end":
			return compactText(errorMessage ?? `${agentLabel(agentId)} completed delegated work.`);
		case "agent_event":
			return compactText(`${agentLabel(agentId)} reported progress.`);
		case "teammate_spawned":
			return compactText(
				`Spawned ${readString(teammate, "runtimeAgentId") ?? readString(teammate, "agentId") ?? agentId ?? "teammate"}.`,
			);
		case "teammate_shutdown":
			return compactText(`${agentLabel(agentId)} stopped${reason ? `: ${reason}` : "."}`);
		case "team_task_updated": {
			const title = readTaskTitle(task);
			const status = readString(task, "status");
			return compactText(`Team task${title ? ` "${title}"` : ""}${status ? ` is ${status}` : " updated"}.`);
		}
		case "team_message": {
			const subject = readString(mailboxMessage, "subject");
			const body = readString(mailboxMessage, "body") ?? readString(mailboxMessage, "message");
			return compactText(subject ?? body ?? "Team message received.");
		}
		case "team_mission_log": {
			const text = readString(missionEntry, "text") ?? readString(missionEntry, "message");
			return compactText(text ?? "Mission log updated.");
		}
		case "run_queued":
			return compactText(`Queued team run${runId ? ` ${runId}` : ""}.`);
		case "run_started":
			return compactText(`Started team run${runId ? ` ${runId}` : ""}.`);
		case "run_progress":
			return compactText(directMessage ?? `Team run${runId ? ` ${runId}` : ""} progressed.`);
		case "run_completed":
			return compactText(`Completed team run${runId ? ` ${runId}` : ""}.`);
		case "run_failed":
			return compactText(`Team run${runId ? ` ${runId}` : ""} failed${runStatus ? ` (${runStatus})` : ""}.`);
		case "run_cancelled":
			return compactText(`Team run${runId ? ` ${runId}` : ""} cancelled${reason ? `: ${reason}` : "."}`);
		case "run_interrupted":
			return compactText(`Team run${runId ? ` ${runId}` : ""} interrupted${reason ? `: ${reason}` : "."}`);
		case "outcome_created":
			return compactText(
				`Created outcome${readString(outcome, "title") ? ` "${readString(outcome, "title")}"` : ""}.`,
			);
		case "outcome_fragment_attached":
			return compactText(
				`Attached outcome fragment${readString(fragment, "id") ? ` ${readString(fragment, "id")}` : ""}.`,
			);
		case "outcome_fragment_reviewed":
			return compactText(
				`Reviewed outcome fragment${readString(fragment, "id") ? ` ${readString(fragment, "id")}` : ""}.`,
			);
		case "outcome_finalized":
			return compactText(
				`Finalized outcome${readString(outcome, "title") ? ` "${readString(outcome, "title")}"` : ""}.`,
			);
		default:
			return compactText(directMessage ?? `Team event: ${eventType}.`);
	}
}

export function projectClineTeamProgressEvent(input: {
	taskId: string;
	teamName: string | null;
	event: ClineSdkTeamEvent;
	createdAt?: number;
}): RuntimeClineTeamProgressEvent {
	const record = asRecord(input.event) ?? {};
	const eventType = readString(record, "type") ?? "team_event";
	const agentId = readString(record, "agentId");
	const run = asRecord(record.run);
	const task = asRecord(record.task);
	const role =
		readString(record, "role") ?? readString(asRecord(record.teammate), "role") ?? readString(task, "assignee");
	return {
		taskId: input.taskId,
		teamName: input.teamName,
		eventType,
		agentId,
		role,
		runId: readRunId(run),
		status: readRunStatus(run) ?? readString(task, "status"),
		message: summarizeTeamEvent(record, eventType, agentId),
		createdAt: input.createdAt ?? Date.now(),
	};
}
