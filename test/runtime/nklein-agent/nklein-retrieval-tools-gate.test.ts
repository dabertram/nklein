import { describe, expect, it } from "vitest";
import {
	type RetrievalToolsGateInput,
	shouldAttachRetrievalTools,
} from "../../../src/nklein-agent/nklein-retrieval-tools-gate";

const ok: RetrievalToolsGateInput = {
	taskId: "task-1",
	egressEnabled: true,
	agentWebResearchAllowed: true,
	searchBackendUrl: "http://localhost:18888",
};

describe("shouldAttachRetrievalTools (§5.AC/§5.L gate)", () => {
	it("attaches the research tool when all four conditions hold", () => {
		expect(shouldAttachRetrievalTools(ok)).toBe(true);
	});

	it("DENIES a synthetic session (::review / ::acceptance / …) — reviewers/critics never get egress", () => {
		expect(shouldAttachRetrievalTools({ ...ok, taskId: "task-1::review" })).toBe(false);
		expect(shouldAttachRetrievalTools({ ...ok, taskId: "task-1::acceptance" })).toBe(false);
	});

	it("is fail-closed on egress — denies when the switch is off", () => {
		expect(shouldAttachRetrievalTools({ ...ok, egressEnabled: false })).toBe(false);
	});

	it("denies when the §5.L per-role capability gate disallows web research", () => {
		expect(shouldAttachRetrievalTools({ ...ok, agentWebResearchAllowed: false })).toBe(false);
	});

	it("denies when no search backend is configured (null / undefined / blank)", () => {
		expect(shouldAttachRetrievalTools({ ...ok, searchBackendUrl: null })).toBe(false);
		expect(shouldAttachRetrievalTools({ ...ok, searchBackendUrl: undefined })).toBe(false);
		expect(shouldAttachRetrievalTools({ ...ok, searchBackendUrl: "   " })).toBe(false);
	});
});
