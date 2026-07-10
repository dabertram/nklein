/**
 * Request classification — map an incoming chat-completions request to a {@link RequestClass} so the right
 * scenario tracks answer it. Classification is DATA-driven (marker strings, overridable) + structural signals
 * (offered tools), so this package stays free of !Klein imports while recognizing !Klein's prompt shells.
 *
 * Structural signals beat text markers: a request OFFERING the `decompose_project` tool is a decompose turn no
 * matter how the system prompt is worded; review/acceptance/chat fall back to system-message markers.
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

/** Defaults tuned to !Klein's shells; override per scenario when shells change. */
export const DEFAULT_REQUEST_CLASS_MARKERS: RequestClassMarkers = {
	toolNameMarkers: {
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
	for (const tool of request.tools ?? []) {
		const name = tool.function?.name;
		const byTool = name ? markers.toolNameMarkers[name] : undefined;
		if (byTool) {
			return byTool;
		}
	}
	const system = markerText(request);
	for (const marker of markers.systemMarkers) {
		if (system.includes(marker.includes)) {
			return marker.requestClass;
		}
	}
	return "chat";
}
