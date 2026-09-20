import { describe, expect, it } from "vitest";

import { formatDeviceLabel } from "@/components/fleet-resource-panel";

describe("formatDeviceLabel", () => {
	it("keeps human machine ids verbatim", () => {
		expect(formatDeviceLabel("local")).toBe("local");
		expect(formatDeviceLabel("legion5pro")).toBe("legion5pro");
	});

	it("renders an opaque LM Link machine hash as a linked host with a short handle", () => {
		expect(formatDeviceLabel("2d30f46d0371d004b1758e6df7790a03")).toBe("linked host 2d30f46d");
	});

	it("does not mistake a short hex-looking name for a hash", () => {
		expect(formatDeviceLabel("cafe1234")).toBe("cafe1234");
	});
});
