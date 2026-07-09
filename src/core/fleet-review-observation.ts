export const AUTO_REVIEWER_SETTINGS = new Set(["", "auto", "none"]);

export interface FleetReviewerObservationInput {
	configuredReviewer: string;
	seenModels: ReadonlySet<string>;
	persistedReviewModels: ReadonlySet<string>;
	workerModel: string;
}

export interface FleetReviewerObservation {
	mode: "auto" | "pinned";
	observed: boolean;
	observedModels: string[];
	reason: string;
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

export function evaluateFleetReviewerObservation(input: FleetReviewerObservationInput): FleetReviewerObservation {
	if (!isAutoReviewerSetting(input.configuredReviewer)) {
		const observedModels = [...input.seenModels].filter((model) =>
			modelUsageMatches(model, input.configuredReviewer),
		);
		return {
			mode: "pinned",
			observed: observedModels.length > 0,
			observedModels,
			reason:
				observedModels.length > 0
					? `pinned reviewer ${input.configuredReviewer} was observed`
					: `pinned reviewer ${input.configuredReviewer} was not observed`,
		};
	}

	const reviewModels = [...input.persistedReviewModels];
	const nonWorkerReviewModels = reviewModels.filter((model) => !modelUsageMatches(model, input.workerModel));
	if (nonWorkerReviewModels.length > 0) {
		return {
			mode: "auto",
			observed: true,
			observedModels: nonWorkerReviewModels,
			reason: "auto reviewer produced persisted review session(s) on a non-worker model",
		};
	}

	return {
		mode: "auto",
		observed: false,
		observedModels: reviewModels,
		reason:
			reviewModels.length === 0
				? "auto reviewer produced no persisted review session"
				: "auto reviewer only produced persisted review session(s) on the worker model",
	};
}
