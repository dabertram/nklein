import { describe, expect, it } from "vitest";
import { resolveClineTeamDelegationPolicy } from "../../../src/cline-sdk/cline-team-delegation";

describe("cline team delegation", () => {
	it("keeps SDK teams disabled by default", () => {
		expect(
			resolveClineTeamDelegationPolicy({
				taskId: "task-1",
				mode: "act",
				env: {},
			}),
		).toMatchObject({
			enabled: false,
		});
	});

	it("enables SDK teams for act sessions when explicitly requested", () => {
		const policy = resolveClineTeamDelegationPolicy({
			taskId: "Task With Spaces",
			mode: "act",
			env: { KANBAN_ENABLE_CLINE_TEAMS: "1" },
		});

		expect(policy.enabled).toBe(true);
		expect(policy.teamName).toContain("kanban");
		expect(policy.teamName).not.toContain(" ");
	});

	it("does not expose team tools in plan mode", () => {
		expect(
			resolveClineTeamDelegationPolicy({
				taskId: "task-1",
				mode: "plan",
				env: { KANBAN_ENABLE_CLINE_TEAMS: "1" },
			}),
		).toMatchObject({
			enabled: false,
		});
	});
});
