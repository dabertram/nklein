import { describe, expect, it } from "vitest";
import {
	clearTerminalGeometry,
	getTerminalGeometry,
	prepareWaitForTerminalGeometry,
	reportTerminalGeometry,
} from "./terminal-geometry-registry";

describe("terminal geometry registry", () => {
	it("reports, reads, and clears geometry by task id", () => {
		expect(getTerminalGeometry("t1")).toBeNull();
		reportTerminalGeometry("t1", { cols: 80, rows: 24 });
		expect(getTerminalGeometry("t1")).toEqual({ cols: 80, rows: 24 });
		clearTerminalGeometry("t1");
		expect(getTerminalGeometry("t1")).toBeNull();
		clearTerminalGeometry("t1"); // clearing again is a no-op
		expect(getTerminalGeometry("t1")).toBeNull();
	});

	it("updates only when geometry actually changes", () => {
		reportTerminalGeometry("t2", { cols: 100, rows: 40 });
		reportTerminalGeometry("t2", { cols: 100, rows: 40 }); // identical ⇒ no-op
		expect(getTerminalGeometry("t2")).toEqual({ cols: 100, rows: 40 });
		reportTerminalGeometry("t2", { cols: 120, rows: 40 });
		expect(getTerminalGeometry("t2")).toEqual({ cols: 120, rows: 40 });
	});

	it("prepareWaitForTerminalGeometry resolves when a new geometry is reported", async () => {
		const wait = prepareWaitForTerminalGeometry("t3", 1000);
		reportTerminalGeometry("t3", { cols: 90, rows: 30 });
		await expect(wait()).resolves.toBeUndefined();
	});

	it("prepareWaitForTerminalGeometry resolves on timeout when nothing changes", async () => {
		const wait = prepareWaitForTerminalGeometry("t4", 20);
		await expect(wait()).resolves.toBeUndefined();
	});
});
