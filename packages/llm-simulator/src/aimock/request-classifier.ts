/**
 * Request classification — map an incoming chat-completions request to a {@link RequestClass} so the right
 * scenario tracks answer it. Classification is DATA-driven (marker strings, overridable) + structural signals
 * (offered tools), so this package stays free of !Klein imports while recognizing !Klein's prompt shells.
 *
 * The class-exclusive `submit_review` tool beats text. Otherwise the preserved worker scaffold beats quoted review
 * feedback in a redriven worker transcript; remaining text markers precede non-exclusive tool fallbacks.
 */

import type { RequestClass } from "../scenario/track-types.js";

export interface ClassifierRequestShape {
	messages?: Array<{ role?: string; content?: unknown }>;
	tools?: Array<{ function?: { name?: string } }>;
}

export interface RequestClassMarkers {
	/** Tool names whose presence in the offered tool list marks a class (checked first). */
	toolNameMarkers: Record<string, RequestClass>;
	/**
	 * Lowercased substrings matched against the concatenated SYSTEM + USER text (first hit wins, in order).
	 * !Klein delivers role framing through both channels (e.g. the review seed "You are the second-opinion
	 * reviewer…" is a USER message), so scanning only system messages missed real classes (live-found while
	 * bringing up the simulated fast path, 2026-07-10).
	 */
	systemMarkers: Array<{ includes: string; requestClass: RequestClass }>;
}

/**
 * Defaults tuned to !Klein's shells (verified against a live request journal, 2026-07-10): the SYSTEM prompt is
 * identical across classes and the FULL tool registry (incl. decompose_project) rides along on worker sessions —
 * so worker text scaffolds beat non-exclusive tool names. `submit_review` is the one genuinely class-exclusive tool
 * and is checked first; this also prevents a quoted `Leaf scope` card prompt inside the review seed from winning.
 */
export const DEFAULT_REQUEST_CLASS_MARKERS: RequestClassMarkers = {
	toolNameMarkers: {
		submit_review: "review",
		decompose_project: "decompose",
	},
	systemMarkers: [
		{ includes: "second-opinion reviewer", requestClass: "review" },
		{ includes: "second-opinion review", requestClass: "review" },
		{ includes: "review the work", requestClass: "review" },
		// The worker card-prompt scaffold (live capture 2026-07-10): "Leaf scope: complete only this card's…".
		{ includes: "leaf scope:", requestClass: "worker" },
		{ includes: "acceptance check", requestClass: "worker" },
		{ includes: "efficiency rules", requestClass: "worker" },
		{ includes: "kanban", requestClass: "worker" },
	],
};

function markerText(request: ClassifierRequestShape): string {
	return (request.messages ?? [])
		.filter((message) => message.role === "system" || message.role === "user")
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")))
		.join("\n")
		.toLowerCase();
}

export function classifyRequest(
	request: ClassifierRequestShape,
	markers: RequestClassMarkers = DEFAULT_REQUEST_CLASS_MARKERS,
): RequestClass {
	const toolClasses = (request.tools ?? []).map((tool) => {
		const name = tool.function?.name;
		return name ? markers.toolNameMarkers[name] : undefined;
	});
	// Review feedback is appended to the SAME worker transcript on a bounce. Its text says "second-opinion reviewer",
	// but the redriven worker does not offer submit_review. Conversely every real reviewer does offer it, making the
	// structural marker authoritative and immune to quoted worker scaffolds inside the review brief.
	if (toolClasses.includes("review")) {
		return "review";
	}
	const text = markerText(request);
	const matchingTextMarkers = markers.systemMarkers.filter((marker) => text.includes(marker.includes));
	const workerMarker = matchingTextMarkers.find((marker) => marker.requestClass === "worker");
	if (workerMarker) {
		return workerMarker.requestClass;
	}
	const firstTextMarker = matchingTextMarkers[0];
	if (firstTextMarker) {
		return firstTextMarker.requestClass;
	}
	for (const toolClass of toolClasses) {
		if (toolClass) {
			return toolClass;
		}
	}
	return "chat";
}
