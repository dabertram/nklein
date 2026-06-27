import { describe, expect, it } from "vitest";
import { NKleinPauseController } from "../../../src/nklein-agent/nklein-pause-controller";

describe("NKleinPauseController pause state", () => {
	it("starts unpaused", () => {
		expect(new NKleinPauseController().isPaused("t")).toBe(false);
	});

	it("a card pause blocks only that task; a board pause blocks every task", () => {
		const c = new NKleinPauseController();
		c.setCardPaused("t1", true);
		expect(c.isPaused("t1")).toBe(true);
		expect(c.isPaused("t2")).toBe(false);
		c.setBoardPaused(true);
		expect(c.isPaused("t2")).toBe(true); // board pause is global
	});

	it("setCardPaused(false) clears that card's pause", () => {
		const c = new NKleinPauseController();
		c.setCardPaused("t1", true);
		c.setCardPaused("t1", false);
		expect(c.isPaused("t1")).toBe(false);
	});

	it("tracks parked task ids separately from the pause gate", () => {
		const c = new NKleinPauseController();
		c.markTaskParked("t1");
		c.markTaskParked("t2");
		expect([...c.listControllerPausedTaskIds()].sort()).toEqual(["t1", "t2"]);
		expect(c.isPaused("t1")).toBe(false); // parked is not the loop pause
		c.clearTaskParked("t1");
		expect(c.listControllerPausedTaskIds()).toEqual(["t2"]);
	});
});

describe("NKleinPauseController.waitUntilResumed", () => {
	it("resolves immediately when not paused", async () => {
		await expect(new NKleinPauseController().waitUntilResumed("t")).resolves.toBeUndefined();
	});

	it("blocks while paused and resolves when resumed", async () => {
		const c = new NKleinPauseController();
		c.setBoardPaused(true);
		let resolved = false;
		const wait = c.waitUntilResumed("t").then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);
		c.setBoardPaused(false);
		await wait;
		expect(resolved).toBe(true);
	});

	it("does not resume while the board is still paused even after the card resumes", async () => {
		const c = new NKleinPauseController();
		c.setBoardPaused(true);
		c.setCardPaused("t", true);
		let resolved = false;
		const wait = c.waitUntilResumed("t").then(() => {
			resolved = true;
		});
		c.setCardPaused("t", false);
		await Promise.resolve();
		await Promise.resolve();
		expect(resolved).toBe(false); // board pause still gates it
		c.setBoardPaused(false);
		await wait;
		expect(resolved).toBe(true);
	});

	it("rejects when the signal is already aborted", async () => {
		const c = new NKleinPauseController();
		c.setBoardPaused(true);
		const ac = new AbortController();
		ac.abort();
		await expect(c.waitUntilResumed("t", ac.signal)).rejects.toThrow(/aborted/u);
	});

	it("rejects when aborted while waiting, and via abortTaskWaiters", async () => {
		const c = new NKleinPauseController();
		c.setBoardPaused(true);
		const ac = new AbortController();
		const viaSignal = c.waitUntilResumed("t", ac.signal);
		ac.abort();
		await expect(viaSignal).rejects.toThrow(/aborted/u);

		const viaController = c.waitUntilResumed("t2");
		c.abortTaskWaiters("t2");
		await expect(viaController).rejects.toThrow(/aborted/u);
	});
});
