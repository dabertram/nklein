import type { RuntimeNKleinTeamProgressEvent } from "../core/stream-events-api-contract";
import { projectNKleinTeamProgressEvent } from "./nklein-team-progress";
import type { NKleinSdkTeamEvent } from "./sdk-runtime-boundary";

/**
 * §5.U — the team-progress pub/sub extracted from `InMemoryNKleinTaskSessionService` as a bounded collaborator: a set of
 * listeners, a subscribe returning an unsubscribe, and an emit that PROJECTS the raw SDK team event to the runtime shape
 * before fanning it out. Self-contained — the projection is a pure import, no service state involved.
 */
export interface TeamProgressEmitter {
	subscribe(listener: (taskId: string, event: RuntimeNKleinTeamProgressEvent) => void): () => void;
	emit(taskId: string, event: NKleinSdkTeamEvent, teamName: string | null): void;
	clear(): void;
}

export function createTeamProgressEmitter(): TeamProgressEmitter {
	const listeners = new Set<(taskId: string, event: RuntimeNKleinTeamProgressEvent) => void>();

	return {
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		emit(taskId, event, teamName) {
			if (listeners.size === 0) {
				return;
			}
			const progressEvent = projectNKleinTeamProgressEvent({ taskId, teamName, event });
			for (const listener of listeners) {
				listener(taskId, progressEvent);
			}
		},
		clear() {
			listeners.clear();
		},
	};
}
