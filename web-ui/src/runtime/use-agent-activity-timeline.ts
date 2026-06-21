import type { RuntimeNKleinTeamProgressEvent, RuntimeTaskSessionSummary } from "@runtime-contract";
import { useEffect, useRef, useState } from "react";
import {
	type AgentActivityEntry,
	accumulateSessionActivity,
	accumulateTeamProgress,
} from "@/runtime/agent-activity-timeline";

/**
 * Keeps a live, accumulated activity timeline for one task by folding each incoming session-summary update and
 * team-progress event through the pure accumulators. Resets when the task changes. This is what powers the
 * "watch the agent's hands" stream from data the runtime already broadcasts (no backend change).
 */
export function useAgentActivityTimeline(
	taskId: string | null,
	summary: RuntimeTaskSessionSummary | null,
	teamProgress: readonly RuntimeNKleinTeamProgressEvent[] = [],
): AgentActivityEntry[] {
	const [timeline, setTimeline] = useState<AgentActivityEntry[]>([]);
	const taskIdRef = useRef<string | null>(taskId);

	useEffect(() => {
		if (taskIdRef.current !== taskId) {
			taskIdRef.current = taskId;
			setTimeline([]);
		}
	}, [taskId]);

	useEffect(() => {
		if (!summary) {
			return;
		}
		setTimeline((current) => accumulateSessionActivity(current, summary));
	}, [summary]);

	useEffect(() => {
		if (teamProgress.length === 0) {
			return;
		}
		setTimeline((current) => accumulateTeamProgress(current, teamProgress));
	}, [teamProgress]);

	return timeline;
}
