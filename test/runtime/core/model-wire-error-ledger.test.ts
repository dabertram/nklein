import { beforeEach, describe, expect, it } from "vitest";
import {
	getLastModelWireError,
	recordModelWireError,
	resetModelWireErrorLedgerForTests,
} from "../../../src/core/model-wire-error-ledger";

/** P0.POOLLOSS: a pool loss is reported WITH the model's last wire error — its crash signature — when one was seen. */
describe("model wire-error ledger", () => {
	beforeEach(() => {
		resetModelWireErrorLedgerForTests();
	});

	it("keeps the newest error per model, capped, and nothing for an unknown model", () => {
		expect(getLastModelWireError("dirk")).toBeUndefined();
		recordModelWireError({
			modelId: "dirk",
			message: "500 Internal Server Error: model crashed",
			atMs: 1_000,
			sessionId: "s1",
		});
		recordModelWireError({ modelId: "dirk", message: `400 ${"x".repeat(400)}`, atMs: 2_000 });
		const last = getLastModelWireError("dirk");
		expect(last?.atMs).toBe(2_000);
		expect(last?.sessionId).toBeNull();
		expect(last?.message.length).toBe(301);
		expect(last?.message.endsWith("…")).toBe(true);
	});

	it("ignores blank ids and blank messages rather than recording a signature that says nothing", () => {
		expect(recordModelWireError({ modelId: " ", message: "boom" })).toBeNull();
		expect(recordModelWireError({ modelId: "dirk", message: "  " })).toBeNull();
		expect(getLastModelWireError("dirk")).toBeUndefined();
	});
});
