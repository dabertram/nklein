import { describe, expect, it } from "vitest";
import type { RuntimeTaskNKleinSettings } from "../../../src/core/api-contract";
import {
	resolveTaskModelSettings,
	resolveTaskRoleSettings,
} from "../../../src/nklein-agent/decomposition/plan-task-routing";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";

const task = (suggestedRole?: string): NKleinPlanTask => ({ suggestedRole }) as unknown as NKleinPlanTask;
const candidate = (providerId: string, modelId: string): NKleinTaskRoutingCandidate =>
	({ entry: { providerId, modelId } }) as unknown as NKleinTaskRoutingCandidate;

describe("resolveTaskRoleSettings (§5.V coverage)", () => {
	const roleSettings: Record<string, RuntimeTaskNKleinSettings> = {
		worker: { providerId: "p", modelId: "m", reasoningEffort: "high" } as RuntimeTaskNKleinSettings,
	};

	it("uses the task's suggestedRole when selectedRole is undefined", () => {
		expect(resolveTaskRoleSettings(task("worker"), roleSettings, undefined)).toEqual({
			providerId: "p",
			modelId: "m",
			reasoningEffort: "high",
		});
	});

	it("lets an explicit selectedRole override the suggestedRole", () => {
		expect(resolveTaskRoleSettings(task("worker"), { architect: { providerId: "a" } } as never, "architect")).toEqual(
			{
				providerId: "a",
			},
		);
	});

	it("trims the role and returns undefined when it resolves to blank / null", () => {
		expect(resolveTaskRoleSettings(task("  worker  "), roleSettings, undefined)).toMatchObject({ providerId: "p" });
		expect(resolveTaskRoleSettings(task("worker"), roleSettings, null)).toBeUndefined(); // null → no role
	});

	it("returns undefined when there are no role settings or the role is absent from them", () => {
		expect(resolveTaskRoleSettings(task("worker"), undefined, undefined)).toBeUndefined();
		expect(resolveTaskRoleSettings(task("ghost"), roleSettings, undefined)).toBeUndefined();
	});

	it("omits falsy string fields but keeps a zero numeric timeout", () => {
		const settings = resolveTaskRoleSettings(
			task("worker"),
			{ worker: { providerId: "", modelId: "m", requestTimeoutMs: 0 } as RuntimeTaskNKleinSettings },
			undefined,
		);
		expect(settings).toEqual({ modelId: "m", requestTimeoutMs: 0 }); // providerId "" dropped, 0 kept
	});
});

describe("resolveTaskModelSettings (§5.V coverage)", () => {
	const roleSettings: Record<string, RuntimeTaskNKleinSettings> = {
		worker: { providerId: "role-p", modelId: "role-m", reasoningEffort: "high" } as RuntimeTaskNKleinSettings,
	};

	it("keeps role-only settings when no concrete routing candidate is chosen", () => {
		expect(resolveTaskModelSettings(null, task("worker"), roleSettings, undefined)).toEqual({
			providerId: "role-p",
			modelId: "role-m",
			reasoningEffort: "high",
		});
	});

	it("takes provider/model from the candidate but keeps the role's other fields", () => {
		expect(resolveTaskModelSettings(candidate("cand-p", "cand-m"), task("worker"), roleSettings, undefined)).toEqual({
			providerId: "cand-p", // from candidate, overriding the role
			modelId: "cand-m",
			reasoningEffort: "high", // carried over from the role
		});
	});
});
