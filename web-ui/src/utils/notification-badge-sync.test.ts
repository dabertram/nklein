import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalStorageKey } from "@/storage/local-storage-store";
import { createNotificationBadgeSyncSourceId, subscribeToNotificationBadgeClear } from "./notification-badge-sync";

const KEY = LocalStorageKey.NotificationBadgeClearEvent;

function fireStorage(key: string, newValue: string | null): void {
	window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

describe("createNotificationBadgeSyncSourceId", () => {
	it("produces a non-empty, unique id", () => {
		const a = createNotificationBadgeSyncSourceId();
		const b = createNotificationBadgeSyncSourceId();
		expect(a.length).toBeGreaterThan(0);
		expect(a).not.toBe(b);
	});
});

describe("subscribeToNotificationBadgeClear", () => {
	let unsub: () => void = () => {};
	afterEach(() => unsub());

	it("fires onClear for a clear event from ANOTHER source, with the workspace id", () => {
		const onClear = vi.fn();
		unsub = subscribeToNotificationBadgeClear("me", onClear);
		fireStorage(KEY, JSON.stringify({ sourceId: "other", workspaceId: "ws-1", triggeredAt: 1 }));
		expect(onClear).toHaveBeenCalledWith("ws-1");
	});

	it("ignores events from the same source, the wrong key, and malformed/incomplete payloads", () => {
		const onClear = vi.fn();
		unsub = subscribeToNotificationBadgeClear("me", onClear);
		fireStorage(KEY, JSON.stringify({ sourceId: "me", workspaceId: "ws-1", triggeredAt: 1 })); // own source
		fireStorage("some.other.key", JSON.stringify({ sourceId: "other", workspaceId: "ws", triggeredAt: 1 })); // wrong key
		fireStorage(KEY, "not json"); // malformed
		fireStorage(KEY, JSON.stringify({ sourceId: "other", triggeredAt: 1 })); // missing workspaceId
		expect(onClear).not.toHaveBeenCalled();
	});

	it("stops firing after unsubscribe", () => {
		const onClear = vi.fn();
		const stop = subscribeToNotificationBadgeClear("me", onClear);
		stop();
		fireStorage(KEY, JSON.stringify({ sourceId: "other", workspaceId: "ws-1", triggeredAt: 1 }));
		expect(onClear).not.toHaveBeenCalled();
	});
});
