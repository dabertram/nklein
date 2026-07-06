import { describe, expect, it } from "vitest";
import {
	parseNKleinProviderSettingsSaveRequest,
	parseNKleinUpdateProviderRequest,
	parseProjectArtifactMigrationRequest,
	parseTaskEvidenceRequest,
	parseTerminalWsClientMessage,
} from "../../../src/core/api-validation";

// §5.V — the provider save/update parsers do the heaviest normalization in this module; the terminal WS parser is the one
// that returns null (tolerant) instead of throwing. Locking those distinct behaviors + the last two simple trimmers.

describe("parseNKleinUpdateProviderRequest (§5.V coverage)", () => {
	it("slugifies providerId (trim/lowercase/spaces→hyphens), filters empty headers, dedupes/trims models", () => {
		const req = parseNKleinUpdateProviderRequest({
			providerId: "  My Provider  ",
			name: "  N  ",
			headers: { "  X-Key  ": "  val  ", drop: "   " },
			models: ["  a  ", "a", "   ", "b"],
		});
		expect(req.providerId).toBe("my-provider");
		expect(req.name).toBe("N");
		expect(req.headers).toEqual({ "X-Key": "val" }); // whitespace-only value dropped
		expect(req.models).toEqual(["a", "b"]); // trimmed, blanks removed, deduped
	});

	it("passes headers:null through and rejects a blank providerId", () => {
		expect(parseNKleinUpdateProviderRequest({ providerId: "p", headers: null }).headers).toBeNull();
		expect(() => parseNKleinUpdateProviderRequest({ providerId: "   " })).toThrow(/Provider ID cannot be empty/);
	});
});

describe("parseNKleinProviderSettingsSaveRequest (§5.V coverage)", () => {
	it("trims providerId and normalizes nested aws/gcp fields (blank → null)", () => {
		const req = parseNKleinProviderSettingsSaveRequest({
			providerId: "  bedrock  ",
			aws: { accessKey: "  k  ", region: "  " },
			gcp: { projectId: "  proj  " },
		});
		expect(req.providerId).toBe("bedrock");
		expect(req.aws).toEqual({ accessKey: "k", region: null });
		expect(req.gcp).toEqual({ projectId: "proj" });
	});

	it("rejects a blank providerId", () => {
		expect(() => parseNKleinProviderSettingsSaveRequest({ providerId: "  " })).toThrow(/Provider ID cannot be empty/);
	});
});

describe("parseTerminalWsClientMessage (§5.V coverage)", () => {
	it("returns the parsed message for a valid discriminated-union member", () => {
		expect(parseTerminalWsClientMessage({ type: "stop" })).toEqual({ type: "stop" });
		expect(parseTerminalWsClientMessage({ type: "resize", cols: 80, rows: 24 })).toEqual({
			type: "resize",
			cols: 80,
			rows: 24,
		});
	});

	it("returns null (tolerant, not throwing) for an invalid message", () => {
		expect(parseTerminalWsClientMessage({ type: "bogus" })).toBeNull();
		expect(parseTerminalWsClientMessage({ type: "resize", cols: -1, rows: 24 })).toBeNull();
		expect(parseTerminalWsClientMessage("not an object")).toBeNull();
	});
});

describe("last simple trimmers (§5.V coverage)", () => {
	it("parseProjectArtifactMigrationRequest trims projectId and rejects blank", () => {
		expect(parseProjectArtifactMigrationRequest({ projectId: "  p  " })).toEqual({ projectId: "p" });
		expect(() => parseProjectArtifactMigrationRequest({ projectId: "   " })).toThrow(/Project ID cannot be empty/);
	});

	it("parseTaskEvidenceRequest trims taskId and rejects blank", () => {
		expect(parseTaskEvidenceRequest({ taskId: "  t  " })).toEqual({ taskId: "t" });
		expect(() => parseTaskEvidenceRequest({ taskId: "   " })).toThrow(/Task evidence taskId cannot be empty/);
	});
});
