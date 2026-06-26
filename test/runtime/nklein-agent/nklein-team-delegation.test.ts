import { describe, expect, it } from "vitest";
import { resolveNKleinTeamDelegationPolicy } from "../../../src/nklein-agent/nklein-team-delegation";

describe("nklein team delegation", () => {
	it("keeps SDK teams disabled by default", () => {
		expect(
			resolveNKleinTeamDelegationPolicy({
				taskId: "task-1",
				mode: "act",
				env: {},
			}),
		).toMatchObject({
			enabled: false,
		});
	});

	it("keeps SDK teams parked in local-only mode even when explicitly requested", () => {
		const policy = resolveNKleinTeamDelegationPolicy({
			taskId: "Task With Spaces",
			mode: "act",
			env: { KANBAN_ENABLE_NKLEIN_TEAMS: "1" },
		});

		expect(policy).toMatchObject({
			enabled: false,
			reason: "SDK team delegation is parked while !Klein is in local-only mode.",
		});
	});

	it("does not expose team tools in plan mode", () => {
		expect(
			resolveNKleinTeamDelegationPolicy({
				taskId: "task-1",
				mode: "plan",
				env: { KANBAN_ENABLE_NKLEIN_TEAMS: "1" },
			}),
		).toMatchObject({
			enabled: false,
		});
	});
});
