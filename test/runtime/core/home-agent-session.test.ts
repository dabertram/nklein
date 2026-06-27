import { describe, expect, it } from "vitest";
import {
	createHomeAgentSessionId,
	HOME_AGENT_SESSION_PREFIX,
	isHomeAgentSessionId,
	isHomeAgentSessionIdForWorkspace,
} from "../../../src/core/home-agent-session";

describe("home agent session ids", () => {
	it("mints a prefixed, workspace+agent-scoped id", () => {
		const id = createHomeAgentSessionId("ws-1", "nklein");
		expect(id.startsWith(HOME_AGENT_SESSION_PREFIX)).toBe(true);
		expect(id).toBe(`${HOME_AGENT_SESSION_PREFIX}ws-1:nklein`);
	});

	it("recognizes a minted id and rejects a normal task id", () => {
		expect(isHomeAgentSessionId(createHomeAgentSessionId("ws-1", "nklein"))).toBe(true);
		expect(isHomeAgentSessionId("task-123")).toBe(false);
	});

	it("scopes the match to a specific workspace", () => {
		const id = createHomeAgentSessionId("ws-1", "nklein");
		expect(isHomeAgentSessionIdForWorkspace(id, "ws-1")).toBe(true);
		expect(isHomeAgentSessionIdForWorkspace(id, "ws-2")).toBe(false);
		// A workspace id prefix-overlap must not false-match: "ws-1" view of a "ws-10" session.
		expect(isHomeAgentSessionIdForWorkspace(createHomeAgentSessionId("ws-10", "nklein"), "ws-1")).toBe(false);
	});
});
