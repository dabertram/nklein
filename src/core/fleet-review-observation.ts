export const AUTO_REVIEWER_SETTINGS = new Set(["", "auto", "none"]);

export interface FleetReviewerObservationInput {
	configuredReviewer: string;
	reviewSessionModels: ReadonlySet<string>;
	workerModel: string;
}

export interface FleetReviewerObservation {
	mode: "auto" | "pinned";
	observed: boolean;
	observedModels: string[];
	reason: string;
}

export interface FleetReviewSessionModelObservation {
	modelId: string;
	taskId: string;
	outcome: "verdict" | "no_verdict";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function isAutoReviewerSetting(value: string | null | undefined): boolean {
	return AUTO_REVIEWER_SETTINGS.has((value ?? "").trim().toLowerCase());
}

export function isPromptReviewSessionId(sessionId: string): boolean {
	return /(?:__review|::review)(?:$|[-_:./])/i.test(sessionId.trim());
}

export function modelUsageMatches(seenModel: string, wantedModel: string): boolean {
	const wanted = wantedModel.trim();
	return wanted.length > 0 && (seenModel === wanted || seenModel.includes(wanted));
}

export function hasModelUsage(seenModels: ReadonlySet<string>, modelId: string): boolean {
	return [...seenModels].some((seen) => modelUsageMatches(seen, modelId));
}

export function extractFleetReviewSessionModelObservation(record: unknown): FleetReviewSessionModelObservation | null {
	if (!isRecord(record)) {
		return null;
	}
	const metadata = isRecord(record.metadata) ? record.metadata : null;
	if (!metadata || stringField(metadata, "category") !== "second_opinion_review_session") {
		return null;
	}
	const outcome = stringField(metadata, "outcome");
	if (outcome !== "verdict" && outcome !== "no_verdict") {
		return null;
	}
	const taskId = stringField(record, "taskId") ?? stringField(metadata, "syntheticTaskId");
	const modelId = stringField(record, "modelId") ?? stringField(metadata, "modelId");
	if (!taskId || !isPromptReviewSessionId(taskId) || !modelId) {
		return null;
	}
	return { modelId, taskId, outcome };
}

export function evaluateFleetReviewerObservation(input: FleetReviewerObservationInput): FleetReviewerObservation {
	const reviewModels = [...input.reviewSessionModels];
	if (!isAutoReviewerSetting(input.configuredReviewer)) {
		const observedModels = reviewModels.filter((model) => modelUsageMatches(model, input.configuredReviewer));
		return {
			mode: "pinned",
			observed: observedModels.length > 0,
			observedModels,
			reason:
				observedModels.length > 0
					? `pinned reviewer ${input.configuredReviewer} produced durable review-session observation(s)`
					: `pinned reviewer ${input.configuredReviewer} produced no durable review-session observation`,
		};
	}

	const nonWorkerReviewModels = reviewModels.filter((model) => !modelUsageMatches(model, input.workerModel));
	if (nonWorkerReviewModels.length > 0) {
		return {
			mode: "auto",
			observed: true,
			observedModels: nonWorkerReviewModels,
			reason: "auto reviewer produced durable review-session observation(s) on a non-worker model",
		};
	}

	return {
		mode: "auto",
		observed: false,
		observedModels: reviewModels,
		reason:
			reviewModels.length === 0
				? "auto reviewer produced no durable review-session observation"
				: "auto reviewer only produced durable review-session observation(s) on the worker model",
	};
}
