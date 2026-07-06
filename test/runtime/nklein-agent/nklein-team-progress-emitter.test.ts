import { describe, expect, it, vi } from "vitest";
import { createTeamProgressEmitter } from "../../../src/nklein-agent/nklein-team-progress-emitter";
import type { NKleinSdkTeamEvent } from "../../../src/nklein-agent/sdk-runtime-boundary";

const teamEvent = (over: Record<string, unknown> = {}): NKleinSdkTeamEvent =>
	({ type: "member_update", ...over }) as unknown as NKleinSdkTeamEvent;

describe("createTeamProgressEmitter (§5.U extraction)", () => {
	it("fans a projected event out to every subscriber with the taskId", () => {
		const emitter = createTeamProgressEmitter();
		const a = vi.fn();
		const b = vi.fn();
		emitter.subscribe(a);
		emitter.subscribe(b);

		emitter.emit("t1", teamEvent(), "team-x");
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		expect(a.mock.calls[0]?.[0]).toBe("t1"); // first arg is the taskId
		expect(a.mock.calls[0]?.[1]).toBeTypeOf("object"); // second is the projected event
	});

	it("unsubscribe stops delivery to that listener only", () => {
		const emitter = createTeamProgressEmitter();
		const a = vi.fn();
		const b = vi.fn();
		const unsubA = emitter.subscribe(a);
		emitter.subscribe(b);

		unsubA();
		emitter.emit("t1", teamEvent(), null);
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("emit is a no-op (no projection) when there are no listeners; clear removes all", () => {
		const emitter = createTeamProgressEmitter();
		expect(() => emitter.emit("t1", teamEvent(), null)).not.toThrow(); // size 0 → early return

		const a = vi.fn();
		emitter.subscribe(a);
		emitter.clear();
		emitter.emit("t1", teamEvent(), null);
		expect(a).not.toHaveBeenCalled();
	});
});
