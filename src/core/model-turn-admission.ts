export interface ModelTurnAdmissionSession {
	taskId: string;
	state: string;
}

export function findActiveSameTaskModelTurn<TSession extends ModelTurnAdmissionSession>(
	taskId: string,
	sessions: readonly TSession[],
): TSession | null {
	return sessions.find((session) => session.taskId === taskId && session.state === "running") ?? null;
}
