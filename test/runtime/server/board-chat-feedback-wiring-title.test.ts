import { describe, expect, it } from "vitest";

import { humanizeWorkspaceChatTitle } from "../../../src/server/board-chat-feedback-wiring";

describe("humanizeWorkspaceChatTitle", () => {
	it("turns generated workspace basenames into readable session titles", () => {
		expect(humanizeWorkspaceChatTitle("nklein-01-clinical-medication-safety-platform-1783658358149-deD9mJ")).toBe(
			"Clinical medication safety platform",
		);
	});

	it("strips the timestamp-nonce tail from dev-test names without an index", () => {
		expect(humanizeWorkspaceChatTitle("nklein-habit-insights-mid-1783653738307-mogxf6ct")).toBe("Habit insights mid");
	});

	it("falls back to the raw name for unfamiliar shapes", () => {
		expect(humanizeWorkspaceChatTitle("MyRepo")).toBe("MyRepo");
	});
});
