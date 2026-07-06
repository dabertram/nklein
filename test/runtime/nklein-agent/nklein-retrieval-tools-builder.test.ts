import { describe, expect, it } from "vitest";
import {
	createRetrievalToolsBuilder,
	type RetrievalConfigSnapshot,
	type RetrievalToolsBuilderDeps,
} from "../../../src/nklein-agent/nklein-retrieval-tools-builder";

const ON: RetrievalConfigSnapshot = {
	egressEnabled: true,
	agentWebResearchAllowed: true,
	searchBackendUrl: "http://localhost:18888",
};

function deps(config: RetrievalConfigSnapshot): RetrievalToolsBuilderDeps {
	return {
		getRetrievalConfig: () => config,
		resolveProviderId: () => "ollama",
		getModelId: () => "m1",
		getEndpoint: () => "http://localhost:1234/v1",
	};
}

describe("createRetrievalToolsBuilder (§5.U extraction)", () => {
	it("attaches the research tool when egress is on + web-research allowed + a backend is configured", () => {
		const tools = createRetrievalToolsBuilder(deps({ ...ON })).build("t1");
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("research");
	});

	it("fails closed (returns []) when egress is off / web-research disallowed / no backend", () => {
		expect(createRetrievalToolsBuilder(deps({ ...ON, egressEnabled: false })).build("t1")).toEqual([]);
		expect(createRetrievalToolsBuilder(deps({ ...ON, agentWebResearchAllowed: false })).build("t1")).toEqual([]);
		expect(createRetrievalToolsBuilder(deps({ ...ON, searchBackendUrl: "   " })).build("t1")).toEqual([]);
		expect(createRetrievalToolsBuilder(deps({ ...ON, searchBackendUrl: null })).build("t1")).toEqual([]);
	});

	it("returns [] for synthetic (::) sessions even with egress fully on — reviewers/critics get no egress", () => {
		expect(createRetrievalToolsBuilder(deps({ ...ON })).build("home::review")).toEqual([]);
	});

	it("reads the config LIVE — a mid-session egress-off fails closed on the very next build (no stale capture)", () => {
		const config: RetrievalConfigSnapshot = { ...ON };
		const builder = createRetrievalToolsBuilder(deps(config));
		expect(builder.build("t1")).toHaveLength(1); // egress on → attached
		config.egressEnabled = false; // operator flips egress off mid-session
		expect(builder.build("t1")).toEqual([]); // next build fails closed against the LIVE config
	});
});
