import { describe, expect, it } from "vitest";
import {
	collectRepoMapPersonalizationText,
	createRepoMapRailMessage,
	REPO_MAP_RAIL_MESSAGE_KIND,
} from "../../../src/nklein-agent/nklein-repo-map-rail-messages";
import type { AgentMessage } from "../../../src/nklein-agent/sdk-agent-types";

function msg(content: unknown, kind?: string): AgentMessage {
	return {
		id: `m-${Math.random()}`,
		role: "user",
		content,
		createdAt: 0,
		...(kind ? { metadata: { kind } } : {}),
	} as unknown as AgentMessage;
}

describe("createRepoMapRailMessage", () => {
	it("builds a user message tagged with the rail kind", () => {
		const message = createRepoMapRailMessage("repo map text");
		expect(message.role).toBe("user");
		expect(message.metadata?.kind).toBe(REPO_MAP_RAIL_MESSAGE_KIND);
		expect(message.content).toEqual([{ type: "text", text: "repo map text" }]);
		expect(message.id.startsWith("kanban-repo-map-rail-")).toBe(true);
	});
});

describe("collectRepoMapPersonalizationText", () => {
	it("extracts text from string content and from array text parts", () => {
		const text = collectRepoMapPersonalizationText([
			msg("plain string"),
			msg([
				{ type: "text", text: "part one" },
				{ type: "text", text: "part two" },
			]),
		]);
		expect(text).toBe("plain string\n\npart one\npart two");
	});

	it("excludes repo-map rail messages", () => {
		const text = collectRepoMapPersonalizationText([msg("keep me"), msg("drop me", REPO_MAP_RAIL_MESSAGE_KIND)]);
		expect(text).toBe("keep me");
	});

	it("skips non-text parts and empty messages", () => {
		const text = collectRepoMapPersonalizationText([
			msg([
				{ type: "image", url: "x" },
				{ type: "text", text: "only text" },
			]),
			msg([]),
		]);
		expect(text).toBe("only text");
	});

	it("caps the result to the last 12000 characters", () => {
		const text = collectRepoMapPersonalizationText([msg("a".repeat(15_000))]);
		expect(text.length).toBe(12_000);
		expect(text).toBe("a".repeat(12_000));
	});
});
