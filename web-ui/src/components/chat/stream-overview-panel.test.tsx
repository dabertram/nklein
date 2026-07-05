import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamOverviewPanel } from "@/components/chat/stream-overview-panel";

const mockGetBoardStreams = vi.fn();

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		chat: {
			getBoardStreams: { query: mockGetBoardStreams },
		},
	}),
}));

// Fake timers so the panel's 5s refresh interval never fires in real time (the fetch is still flushed via
// advanceTimersByTimeAsync, which drains microtasks between timer steps).
async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
}

describe("StreamOverviewPanel (§5.AU)", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		mockGetBoardStreams.mockReset();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		vi.restoreAllMocks();
		vi.useRealTimers();
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
			previousActEnvironment;
	});

	it("renders a row per stream with its health, progress, and running count", async () => {
		mockGetBoardStreams.mockResolvedValue({
			streams: [
				{ id: "s1", title: "Auth", health: "at_risk", done: 1, total: 3, running: 2 },
				{ id: "s2", title: "Billing", health: "done", done: 4, total: 4, running: 0 },
			],
			ungroupedCardCount: 1,
		});
		act(() => {
			root.render(<StreamOverviewPanel enabled={true} />);
		});
		await flush();

		expect(container.querySelector('[data-testid="chat-stream-overview"]')).not.toBeNull();
		const s1 = container.querySelector('[data-testid="chat-stream-row-s1"]');
		expect(s1?.textContent).toContain("Auth");
		expect(s1?.textContent).toContain("at risk");
		expect(s1?.textContent).toContain("1/3");
		expect(s1?.textContent).toContain("2 running");
		// A done stream with nothing running shows no "running" note.
		expect(container.querySelector('[data-testid="chat-stream-row-s2"]')?.textContent).not.toContain("running");
		expect(container.textContent).toContain("+1 card(s) not in a stream");
	});

	it("renders nothing when there are no streams", async () => {
		mockGetBoardStreams.mockResolvedValue({ streams: [], ungroupedCardCount: 0 });
		act(() => {
			root.render(<StreamOverviewPanel enabled={true} />);
		});
		await flush();
		expect(container.querySelector('[data-testid="chat-stream-overview"]')).toBeNull();
	});

	it("calls onSelectStream with the stream id when a row is clicked", async () => {
		const onSelectStream = vi.fn();
		mockGetBoardStreams.mockResolvedValue({
			streams: [{ id: "s1", title: "Auth", health: "on_track", done: 0, total: 2, running: 1 }],
			ungroupedCardCount: 0,
		});
		act(() => {
			root.render(<StreamOverviewPanel enabled={true} onSelectStream={onSelectStream} />);
		});
		await flush();
		const row = container.querySelector('[data-testid="chat-stream-row-s1"]') as HTMLButtonElement | null;
		expect(row).not.toBeNull();
		act(() => {
			row?.click();
		});
		expect(onSelectStream).toHaveBeenCalledWith("s1");
	});

	it("does not fetch or render when disabled", async () => {
		act(() => {
			root.render(<StreamOverviewPanel enabled={false} />);
		});
		await flush();
		expect(mockGetBoardStreams).not.toHaveBeenCalled();
		expect(container.querySelector('[data-testid="chat-stream-overview"]')).toBeNull();
	});
});
