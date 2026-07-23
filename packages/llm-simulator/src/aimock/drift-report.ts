/**
 * N12 — recording-staleness DIAGNOSIS for unmatched aimock requests. When a drain leaves requests unmatched, the
 * failure must distinguish "behavior broken" (the run's request SHAPE changed: an unexpected request class, or a
 * turn structure the track ladder never scripted) from "re-record needed" (the flow shape still matches a track,
 * but the PROMPT TEXT drifted past the track's needle — the F4.40 stable-prefix contract moved legitimately).
 * Without the distinction the suite decays into noise: every legitimate prompt change reads as a regression.
 *
 * Pure data-in/data-out over the simulator journal + the ScenarioScript that was served; no !Klein imports.
 */

import type { RequestClass, ScenarioScript, ScenarioTrack } from "../scenario/track-types.js";
import {
	type ClassifierRequestShape,
	classifyRequest,
	DEFAULT_REQUEST_CLASS_MARKERS,
	type RequestClassMarkers,
} from "./request-classifier.js";

/** One reason a specific track did not match a specific request. */
export type TrackCheckFailure = "needle" | "request_class" | "assistant_count";

/** How one unmatched request relates to its closest track(s). */
export type UnmatchedRequestKind =
	/** A track matched on class + turn shape and failed ONLY its needle — the prompt text drifted. */
	| "prompt_drift"
	/** A track matched on class + needle but the per-session assistant count fell outside its scripted turns. */
	| "turn_shape_drift"
	/** No track expects this request class at all — the run performed a request the recording never scripted. */
	| "unscripted_request_class";

export interface NeedleDriftDetail {
	/** The track's needle (lowercased matching contract). */
	needle: string;
	/** Byte offset into the needle where the request's text stops agreeing (== needle.length would mean a match). */
	firstDivergingByte: number;
	/** The needle from the divergence point (what the recording expects and the request no longer says). */
	expectedFromDivergence: string;
	/** Excerpt of the request's user text around the best partial occurrence (empty when nothing matched at all). */
	requestExcerpt: string;
}

export interface TrackDriftDiagnosis {
	trackId: string;
	requestClass: RequestClass;
	failedChecks: TrackCheckFailure[];
	needleDrift?: NeedleDriftDetail;
	/** Present when the assistant-count check failed: what the request carried vs what the track answers. */
	assistantCountDrift?: { observed: number; accepted: string };
}

export interface UnmatchedRequestDiagnosis {
	/** Index of the request within the journal slice handed in (presentation only). */
	requestIndex: number;
	requestClass: RequestClass;
	assistantCount: number;
	kind: UnmatchedRequestKind;
	/** Closest tracks first (fewest failed checks; needle-only failures preferred). At most three. */
	closestTracks: TrackDriftDiagnosis[];
}

export interface ScenarioDriftReport {
	scenarioName: string;
	unmatchedCount: number;
	/** The single actionable verdict: what kind of failure this is. */
	verdict: "clean" | "re_record_needed" | "behavior_broken" | "mixed";
	requests: UnmatchedRequestDiagnosis[];
}

interface JournalLikeEntry {
	body?: unknown;
	request?: unknown;
	response?: { fixture?: unknown };
	path?: string;
}

interface ChatRequestShape extends ClassifierRequestShape {
	messages?: Array<{ role?: string; content?: unknown }>;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text ?? "") : "",
			)
			.join("\n");
	}
	return "";
}

function userText(request: ChatRequestShape): string {
	return (request.messages ?? [])
		.filter((message) => message.role === "user")
		.map((message) => contentToText(message.content))
		.join("\n");
}

function assistantCount(request: ChatRequestShape): number {
	return (request.messages ?? []).filter((message) => message.role === "assistant").length;
}

/**
 * Longest needle PREFIX still present in the text (case-insensitive, mirroring the matcher's contract). Returns
 * needle.length when the whole needle is present. Linear scan — needles are short authoring strings.
 */
function longestNeedlePrefixPresent(text: string, needle: string): number {
	const haystack = text.toLowerCase();
	const target = needle.toLowerCase();
	let longest = 0;
	for (let length = target.length; length > 0; length -= 1) {
		if (haystack.includes(target.slice(0, length))) {
			longest = length;
			break;
		}
	}
	return longest;
}

const EXCERPT_CONTEXT_BYTES = 80;

function needleDrift(text: string, needle: string): NeedleDriftDetail {
	const firstDivergingByte = longestNeedlePrefixPresent(text, needle);
	const matchedPrefix = needle.slice(0, firstDivergingByte).toLowerCase();
	const occurrenceOffset = matchedPrefix.length > 0 ? text.toLowerCase().indexOf(matchedPrefix) : -1;
	const requestExcerpt =
		occurrenceOffset >= 0
			? text.slice(occurrenceOffset, occurrenceOffset + matchedPrefix.length + EXCERPT_CONTEXT_BYTES)
			: "";
	return {
		needle,
		firstDivergingByte,
		expectedFromDivergence: needle.slice(firstDivergingByte, firstDivergingByte + EXCERPT_CONTEXT_BYTES),
		requestExcerpt,
	};
}

/** Which per-session assistant counts a track's turn ladder answers, as a human-readable contract. */
function acceptedCounts(track: ScenarioTrack): string {
	const base = track.atAssistantCount ?? 0;
	if (track.cycleTurns) {
		return `count ≥ ${base}, cycling over ${track.turns.length} turn(s)`;
	}
	const last = base + track.turns.length - 1;
	if (track.repeatLastTurn) {
		return track.turns.length === 1 ? `count ≥ ${base}` : `${base}–${last - 1}, then ≥ ${last}`;
	}
	return track.turns.length === 1 ? `count = ${base}` : `count ${base}–${last}`;
}

function trackAnswersCount(track: ScenarioTrack, count: number): boolean {
	const base = track.atAssistantCount ?? 0;
	if (track.cycleTurns || track.repeatLastTurn) {
		// Cycling answers every count ≥ base; repeat-last extends the final turn to every later count.
		return count >= base;
	}
	return count >= base && count <= base + track.turns.length - 1;
}

function diagnoseTrack(
	track: ScenarioTrack,
	request: ChatRequestShape,
	requestClass: RequestClass,
): TrackDriftDiagnosis {
	const failedChecks: TrackCheckFailure[] = [];
	let drift: NeedleDriftDetail | undefined;
	if (track.userMessageIncludes) {
		const text = userText(request);
		if (!text.toLowerCase().includes(track.userMessageIncludes.toLowerCase())) {
			failedChecks.push("needle");
			drift = needleDrift(text, track.userMessageIncludes);
		}
	}
	if (track.requestClass !== "any" && track.requestClass !== requestClass) {
		failedChecks.push("request_class");
	}
	const count = assistantCount(request);
	let countDrift: TrackDriftDiagnosis["assistantCountDrift"];
	if (!trackAnswersCount(track, count)) {
		failedChecks.push("assistant_count");
		countDrift = { observed: count, accepted: acceptedCounts(track) };
	}
	return {
		trackId: track.id,
		requestClass: track.requestClass,
		failedChecks,
		...(drift ? { needleDrift: drift } : {}),
		...(countDrift ? { assistantCountDrift: countDrift } : {}),
	};
}

/** Sort key: fewest failed checks first; among ties, a needle-only failure is the most informative. */
function diagnosisRank(diagnosis: TrackDriftDiagnosis): number {
	const needleOnly = diagnosis.failedChecks.length === 1 && diagnosis.failedChecks[0] === "needle";
	return diagnosis.failedChecks.length * 2 + (needleOnly ? 0 : 1);
}

function classifyUnmatched(closest: TrackDriftDiagnosis | undefined): UnmatchedRequestKind {
	if (!closest) {
		return "unscripted_request_class";
	}
	if (closest.failedChecks.length === 1 && closest.failedChecks[0] === "needle") {
		return "prompt_drift";
	}
	if (closest.failedChecks.length === 1 && closest.failedChecks[0] === "assistant_count") {
		return "turn_shape_drift";
	}
	if (closest.failedChecks.includes("request_class")) {
		return "unscripted_request_class";
	}
	return "turn_shape_drift";
}

/** Extract the chat request body from a journal-like entry (aimock journal or a persisted journal.json). */
export function chatRequestFromJournalEntry(entry: unknown): ChatRequestShape | null {
	const shaped = entry as JournalLikeEntry;
	const raw = shaped.body ?? shaped.request;
	if (!raw) {
		return null;
	}
	const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
	if (!parsed || typeof parsed !== "object" || !("messages" in (parsed as Record<string, unknown>))) {
		return null;
	}
	return parsed as ChatRequestShape;
}

/** True when a journal entry represents a request no fixture served. */
export function isUnmatchedJournalEntry(entry: unknown): boolean {
	const shaped = entry as JournalLikeEntry;
	return shaped.response !== undefined && (shaped.response?.fixture ?? null) === null;
}

export interface BuildDriftReportOptions {
	markers?: RequestClassMarkers;
	/** Cap the per-request closest-track list (default 3). */
	maxClosestTracks?: number;
}

/**
 * Diagnose the given unmatched chat requests against the scenario that was serving the run. The requests may be
 * live journal entries (`mock.getRequests()` filtered by {@link isUnmatchedJournalEntry}) or already-extracted
 * chat bodies.
 */
export function buildScenarioDriftReport(
	unmatchedRequests: readonly unknown[],
	script: ScenarioScript,
	options: BuildDriftReportOptions = {},
): ScenarioDriftReport {
	const markers = options.markers ?? DEFAULT_REQUEST_CLASS_MARKERS;
	const maxClosest = options.maxClosestTracks ?? 3;
	const requests: UnmatchedRequestDiagnosis[] = [];
	for (const [index, entry] of unmatchedRequests.entries()) {
		const request = chatRequestFromJournalEntry(entry) ?? (entry as ChatRequestShape);
		if (!request || !Array.isArray(request.messages)) {
			continue;
		}
		const requestClass = classifyRequest(request, markers);
		const diagnoses = script.tracks
			.map((track) => diagnoseTrack(track, request, requestClass))
			.filter((diagnosis) => diagnosis.failedChecks.length > 0)
			.sort((a, b) => diagnosisRank(a) - diagnosisRank(b));
		requests.push({
			requestIndex: index,
			requestClass,
			assistantCount: assistantCount(request),
			kind: classifyUnmatched(diagnoses[0]),
			closestTracks: diagnoses.slice(0, maxClosest),
		});
	}
	const kinds = new Set(requests.map((request) => request.kind));
	const hasDrift = kinds.has("prompt_drift");
	const hasBroken = kinds.has("turn_shape_drift") || kinds.has("unscripted_request_class");
	return {
		scenarioName: script.name,
		unmatchedCount: requests.length,
		verdict: requests.length === 0 ? "clean" : hasDrift && hasBroken ? "mixed" : hasDrift ? "re_record_needed" : "behavior_broken",
		requests,
	};
}

const KIND_LABEL: Record<UnmatchedRequestKind, string> = {
	prompt_drift: "PROMPT DRIFT (re-record needed)",
	turn_shape_drift: "TURN-SHAPE DRIFT (behavior broken)",
	unscripted_request_class: "UNSCRIPTED REQUEST (behavior broken)",
};

/**
 * Render the report for a failing drain's output. `reRecordCommand` names the one-command remedy for the
 * re-record case (e.g. `npm run scenario:rerecord -- 07`); it is printed only when prompt drift was found.
 */
export function formatScenarioDriftReport(report: ScenarioDriftReport, reRecordCommand?: string): string {
	if (report.verdict === "clean") {
		return `Scenario "${report.scenarioName}": no unmatched requests — recordings cover the run.`;
	}
	const lines: string[] = [
		`Scenario "${report.scenarioName}": ${report.unmatchedCount} unmatched request(s) — verdict: ${report.verdict.toUpperCase().replaceAll("_", " ")}.`,
	];
	for (const request of report.requests) {
		lines.push(
			`— request ${request.requestIndex} [class=${request.requestClass}, assistants=${request.assistantCount}]: ${KIND_LABEL[request.kind]}`,
		);
		for (const track of request.closestTracks) {
			const parts = [`   closest track "${track.trackId}" (${track.requestClass}) failed: ${track.failedChecks.join(", ")}`];
			if (track.needleDrift) {
				parts.push(
					`     needle diverges at byte ${track.needleDrift.firstDivergingByte}/${track.needleDrift.needle.length}: expected …"${track.needleDrift.expectedFromDivergence}"`,
				);
				if (track.needleDrift.requestExcerpt) {
					parts.push(`     request says …"${track.needleDrift.requestExcerpt}"`);
				}
			}
			if (track.assistantCountDrift) {
				parts.push(
					`     track answers ${track.assistantCountDrift.accepted}; request carried ${track.assistantCountDrift.observed} assistant message(s)`,
				);
			}
			lines.push(...parts);
		}
	}
	if ((report.verdict === "re_record_needed" || report.verdict === "mixed") && reRecordCommand) {
		lines.push(
			`Prompt drift means the recording is stale, not that behavior regressed — re-record the cell with: ${reRecordCommand}`,
		);
	}
	if (report.verdict === "behavior_broken" || report.verdict === "mixed") {
		lines.push(
			"Turn-shape / unscripted-request findings mean the RUN changed shape (an extra, missing, or new kind of model call) — investigate the behavior change before touching the recordings.",
		);
	}
	return lines.join("\n");
}
