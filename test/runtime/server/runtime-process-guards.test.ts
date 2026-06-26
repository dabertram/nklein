import { describe, expect, it, vi } from "vitest";
import { handleRuntimeUnhandledRejection } from "../../../src/server/runtime-process-guards";

describe("handleRuntimeUnhandledRejection (§5.V #3 runtime resilience guard)", () => {
	it("logs visibly AND captures an Error reason to telemetry with area=unhandledRejection", () => {
		const logError = vi.fn();
		const capture = vi.fn();
		const reason = new Error("session_stop");

		handleRuntimeUnhandledRejection(reason, { capture, logError });

		expect(capture).toHaveBeenCalledTimes(1);
		expect(capture).toHaveBeenCalledWith(reason, { area: "unhandledRejection" });
		expect(logError).toHaveBeenCalledTimes(1);
		const logged = logError.mock.calls[0]?.[0] as string;
		expect(logged).toContain("unhandled promise rejection");
		expect(logged).toContain("runtime continues");
		expect(logged).toContain("session_stop");
	});

	it("wraps a non-Error reason in an Error before capturing", () => {
		const logError = vi.fn();
		const capture = vi.fn();

		handleRuntimeUnhandledRejection("plain string rejection", { capture, logError });

		expect(capture).toHaveBeenCalledTimes(1);
		const captured = capture.mock.calls[0]?.[0];
		expect(captured).toBeInstanceOf(Error);
		expect((captured as Error).message).toBe("plain string rejection");
	});

	it("logs before capturing (visibility is the priority)", () => {
		const order: string[] = [];
		handleRuntimeUnhandledRejection(new Error("x"), {
			logError: () => order.push("log"),
			capture: () => order.push("capture"),
		});
		expect(order).toEqual(["log", "capture"]);
	});

	it("never throws even if logging/telemetry fail — it must not escalate the rejection", () => {
		expect(() =>
			handleRuntimeUnhandledRejection(new Error("boom"), {
				logError: () => {
					throw new Error("logger down");
				},
				capture: () => {
					throw new Error("telemetry down");
				},
			}),
		).not.toThrow();
	});
});
