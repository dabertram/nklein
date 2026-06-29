import { describe, expect, it, vi } from "vitest";
import {
	getTerminalController,
	registerTerminalController,
	type TerminalController,
	waitForTerminalLikelyPrompt,
} from "./terminal-controller-registry";

const controller = (extra: Partial<TerminalController> = {}): TerminalController => ({
	input: () => true,
	paste: () => true,
	...extra,
});

describe("terminal controller registry", () => {
	it("registers, reads, and unregisters by task id", () => {
		expect(getTerminalController("c1")).toBeNull();
		const c = controller();
		const unregister = registerTerminalController("c1", c);
		expect(getTerminalController("c1")).toBe(c);
		unregister();
		expect(getTerminalController("c1")).toBeNull();
	});

	it("unregister is identity-guarded: it won't remove a newer controller for the same id", () => {
		const c1 = controller();
		const unregister1 = registerTerminalController("c2", c1);
		const c2 = controller();
		registerTerminalController("c2", c2); // replaces c1
		unregister1(); // stale teardown must NOT remove c2
		expect(getTerminalController("c2")).toBe(c2);
	});
});

describe("waitForTerminalLikelyPrompt", () => {
	it("returns false without a controller or without the optional waiter", async () => {
		expect(await waitForTerminalLikelyPrompt("missing", 100)).toBe(false);
		registerTerminalController("c3", controller());
		expect(await waitForTerminalLikelyPrompt("c3", 100)).toBe(false);
	});

	it("delegates to the controller's waitForLikelyPrompt when present", async () => {
		const waitForLikelyPrompt = vi.fn(async () => true);
		registerTerminalController("c4", controller({ waitForLikelyPrompt }));
		expect(await waitForTerminalLikelyPrompt("c4", 250)).toBe(true);
		expect(waitForLikelyPrompt).toHaveBeenCalledWith(250);
	});
});
