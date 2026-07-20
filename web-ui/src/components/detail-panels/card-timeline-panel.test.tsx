import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardTimelinePanel } from "./card-timeline-panel";

/**
 * N18 — the timeline panel's job is to be HONEST, not pretty.
 *
 * Every test here is about a way the panel could quietly mislead: a load failure rendering as an empty card, an
 * unreadable source rendering as silence, a truncated list rendering as complete. Those are the failure modes
 * that make a forensic tool worse than none, because the reader draws a confident wrong conclusion instead of
 * going to look.
 */

const fetchCardTimeline = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/queries/task-control", () => ({ fetchCardTimeline }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	fetchCardTimeline.mockReset();
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

function response(overrides: Record<string, unknown> = {}) {
	return {
		cardId: "c1",
		events: [{ at: 1_700_000_000_000, source: "observation", kind: "card_lane_change", detail: "moved a → b" }],
		sourcesRead: [{ source: "observation", available: true, eventCount: 1, note: "" }],
		partial: false,
		summary: "1 event",
		totalEvents: 1,
		...overrides,
	};
}

async function mountAndOpen(): Promise<void> {
	await act(async () => {
		root.render(<CardTimelinePanel workspaceId="w1" taskId="c1" />);
	});
	const toggle = host.querySelector("button") as HTMLButtonElement;
	await act(async () => {
		toggle.click();
	});
	// Let the fetch promise settle.
	await act(async () => {
		await Promise.resolve();
	});
}

describe("CardTimelinePanel", () => {
	it("does not fetch until opened — the panel is collapsed by default", async () => {
		await act(async () => {
			root.render(<CardTimelinePanel workspaceId="w1" taskId="c1" />);
		});
		expect(fetchCardTimeline).not.toHaveBeenCalled();
	});

	it("renders events in the order given, without regrouping", async () => {
		fetchCardTimeline.mockResolvedValue(response());
		await mountAndOpen();
		expect(host.textContent).toContain("card_lane_change");
		expect(host.textContent).toContain("moved a → b");
	});

	it("says a LOAD FAILURE is not an empty card", async () => {
		// The single most dangerous rendering: an unreachable endpoint that looks like an idle card.
		fetchCardTimeline.mockRejectedValue(new Error("network down"));
		await mountAndOpen();
		expect(host.textContent).toContain("not an empty card");
	});

	it("warns that a gap may be an UNREADABLE SOURCE rather than silence", async () => {
		fetchCardTimeline.mockResolvedValue(
			response({
				partial: true,
				sourcesRead: [{ source: "ledger", available: false, eventCount: 0, note: "ledger absent" }],
			}),
		);
		await mountAndOpen();
		expect(host.textContent).toContain("PARTIAL");
		expect(host.textContent).toContain("may be");
	});

	it("says so when the list is TRUNCATED, so a partial view is not read as complete", async () => {
		fetchCardTimeline.mockResolvedValue(response({ totalEvents: 900 }));
		await mountAndOpen();
		expect(host.textContent).toContain("most recent 1 of 900");
	});

	it("qualifies an EMPTY timeline when a source was unreadable", async () => {
		// "No events" plus "a source failed" must not render as a confident "nothing happened".
		fetchCardTimeline.mockResolvedValue(
			response({
				events: [],
				totalEvents: 0,
				partial: true,
				sourcesRead: [{ source: "log", available: false, eventCount: 0, note: "absent" }],
			}),
		);
		await mountAndOpen();
		expect(host.textContent).toContain("may be incomplete");
	});

	it("renders a dash for an unclocked event rather than inventing a time", async () => {
		fetchCardTimeline.mockResolvedValue(
			response({ events: [{ at: 0, source: "log", kind: "line", detail: "no timestamp" }] }),
		);
		await mountAndOpen();
		expect(host.textContent).toContain("—");
	});
});
