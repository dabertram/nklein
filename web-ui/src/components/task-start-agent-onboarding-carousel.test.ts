import { describe, expect, it } from "vitest";

import { resolveOnboardingAgentIds } from "@/components/task-start-agent-onboarding-carousel";

describe("resolveOnboardingAgentIds", () => {
	it("lists only local NKlein when cloud providers are disabled", () => {
		expect(resolveOnboardingAgentIds(false)).toEqual(["nklein"]);
	});

	it("keeps all onboarding agents when cloud providers are enabled", () => {
		expect(resolveOnboardingAgentIds(true)).toEqual(["nklein"]);
	});
});
