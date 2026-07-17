import { describe, expect, it } from "vitest";
import { assessAirGapPosture } from "../../../src/core/air-gap-posture";

describe("assessAirGapPosture", () => {
	it("reports air-gapped when every egress class is closed", () => {
		const posture = assessAirGapPosture({
			webResearchEnabled: false,
			autoUpdateEnabled: false,
			configuredMcpServers: 0,
			providerBaseUrl: "http://localhost:1234/v1",
		});
		expect(posture.airGapped).toBe(true);
		expect(posture.summary).toContain("AIR-GAPPED");
	});

	it("names each open class and flags a NON-LOCAL provider endpoint loudly", () => {
		const posture = assessAirGapPosture({
			webResearchEnabled: true,
			autoUpdateEnabled: true,
			configuredMcpServers: 2,
			providerBaseUrl: "https://api.example.com/v1",
		});
		expect(posture.airGapped).toBe(false);
		expect(posture.classes.filter((status) => status.open)).toHaveLength(4);
		expect(posture.summary).toContain("web_research");
		expect(posture.classes.find((s) => s.egressClass === "model_inference")?.detail).toContain("leave this machine");
	});

	it("treats a missing provider URL as local-default (closed)", () => {
		const posture = assessAirGapPosture({
			webResearchEnabled: false,
			autoUpdateEnabled: false,
			configuredMcpServers: 0,
			providerBaseUrl: null,
		});
		expect(posture.classes.find((s) => s.egressClass === "model_inference")?.open).toBe(false);
	});
});
