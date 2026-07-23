import { describe, expect, it } from "vitest";
import {
	buildNightlyHermeticEvidence,
	NIGHTLY_HERMETIC_EVIDENCE,
	parseNightlyHermeticEvidence,
} from "../../src/core/nightly-hermeticity";

const VALID = {
	env: {
		NKLEIN_NIGHTLY_HERMETIC: "1",
		NKLEIN_NO_AUTO_UPDATE: "1",
		BASIC_MEMORY_AUTO_UPDATE: "false",
	},
	modelGatewayUrl: "http://127.0.0.1:43123/v1",
	lmsBin: "/isolated/fake-lms.sh",
	sandboxCapabilityPreset: "strict",
	runtimePortMode: "ephemeral",
} as const;

describe("nightly hermeticity", () => {
	it("issues the complete receipt only for the enforced posture", () => {
		expect(buildNightlyHermeticEvidence(VALID)).toEqual(NIGHTLY_HERMETIC_EVIDENCE);
	});

	it.each([
		["ambient mode", { ...VALID, env: { ...VALID.env, NKLEIN_NIGHTLY_HERMETIC: "0" } }],
		["remote gateway", { ...VALID, modelGatewayUrl: "http://192.0.2.1:1234/v1" }],
		["updates enabled", { ...VALID, env: { ...VALID.env, NKLEIN_NO_AUTO_UPDATE: "0" } }],
		["sandbox egress", { ...VALID, sandboxCapabilityPreset: "fully_open" }],
		["probe-selected port", { ...VALID, runtimePortMode: "auto" }],
	])("refuses %s", (_name, input) => {
		expect(() => buildNightlyHermeticEvidence(input)).toThrow();
	});

	it("parses the exact receipt and rejects drift or extra claims", () => {
		expect(parseNightlyHermeticEvidence(JSON.stringify(NIGHTLY_HERMETIC_EVIDENCE))).toEqual(
			NIGHTLY_HERMETIC_EVIDENCE,
		);
		expect(() =>
			parseNightlyHermeticEvidence(JSON.stringify({ ...NIGHTLY_HERMETIC_EVIDENCE, powerMode: "host" })),
		).toThrow(/powerMode/);
		expect(() =>
			parseNightlyHermeticEvidence(JSON.stringify({ ...NIGHTLY_HERMETIC_EVIDENCE, unsupported: true })),
		).toThrow(/unknown fields/);
	});
});
