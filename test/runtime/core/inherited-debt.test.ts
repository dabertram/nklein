import { describe, expect, it } from "vitest";
import {
	closeInheritedDebtForPassingCommand,
	describeInheritedDebtForPlanning,
	foldInheritedDebtSighting,
	type InheritedDebtRecord,
	inheritedDebtSignature,
	shouldRecordInheritedDebt,
} from "../../../src/core/inherited-debt";

const FAILURE = [
	"> dark-factory@0.0.1 test",
	"> vitest run",
	"",
	"FAIL test/kernel/ledger.test.ts",
	"AssertionError: conservation violated: debits 1200 credits 1150",
	"    at Object.<anonymous> (/workspaces/x/test/kernel/ledger.test.ts:41:9)",
	"Duration  882ms",
].join("\n");

function sight(over: Partial<Parameters<typeof foldInheritedDebtSighting>[1]> = {}) {
	return {
		signature: inheritedDebtSignature("npm test", FAILURE),
		workspacePath: "/repo",
		command: "npm test",
		taskId: "s07",
		baselineOutput: FAILURE,
		baselineExitCode: 1,
		at: 1_000,
		...over,
	};
}

describe("inherited debt — a waiver costs something", () => {
	it("records debt by default and only skips it when carrying the breakage was explicitly requested", () => {
		expect(shouldRecordInheritedDebt({ waived: true })).toBe(true);
		expect(shouldRecordInheritedDebt({ waived: true, carryPreExistingBreakageRequested: false })).toBe(true);
		expect(shouldRecordInheritedDebt({ waived: true, carryPreExistingBreakageRequested: true })).toBe(false);
		// No waiver, no debt: a failure the worker actually caused stays the worker's.
		expect(shouldRecordInheritedDebt({ waived: false })).toBe(false);
	});

	it("identifies a breakage by command AND failure, so a different failure of the same command is different debt", () => {
		const same = inheritedDebtSignature("npm test", `${FAILURE}\n    at another/frame.ts:9:1`);
		expect(inheritedDebtSignature("npm  test", FAILURE)).toBe(inheritedDebtSignature("npm test", FAILURE));
		// Stack frames and timings are decoration, not identity.
		expect(same).toBe(inheritedDebtSignature("npm test", FAILURE));
		expect(inheritedDebtSignature("npm test", FAILURE.replace("conservation violated", "schema mismatch"))).not.toBe(
			inheritedDebtSignature("npm test", FAILURE),
		);
		expect(inheritedDebtSignature("npm run typecheck", FAILURE)).not.toBe(
			inheritedDebtSignature("npm test", FAILURE),
		);
	});

	it("counts encounters instead of duplicating: the cost of not fixing it is visible", () => {
		const first = foldInheritedDebtSighting([], sight());
		expect(first).toHaveLength(1);
		expect(first[0]).toMatchObject({ status: "open", encounters: 1, firstSeenTaskId: "s07", baselineExitCode: 1 });

		const second = foldInheritedDebtSighting(first, sight({ taskId: "s11", at: 2_000 }));
		expect(second).toHaveLength(1);
		expect(second[0]).toMatchObject({ encounters: 2, firstSeenTaskId: "s07", lastSeenAt: 2_000 });

		// A genuinely different breakage of the same command opens its own debt.
		const other = FAILURE.replace("conservation violated", "schema mismatch");
		const third = foldInheritedDebtSighting(
			second,
			sight({ signature: inheritedDebtSignature("npm test", other), baselineOutput: other, at: 3_000 }),
		);
		expect(third).toHaveLength(2);
	});

	it("closes on the evidence that the command is green at base, and only for that command", () => {
		const open = foldInheritedDebtSighting(
			foldInheritedDebtSighting([], sight()),
			sight({ command: "npm run typecheck", signature: inheritedDebtSignature("npm run typecheck", FAILURE) }),
		);
		expect(open.filter((record) => record.status === "open")).toHaveLength(2);

		const { records, closed } = closeInheritedDebtForPassingCommand(open, "npm  test", 5_000);
		expect(closed).toHaveLength(1);
		expect(closed[0]?.command).toBe("npm test");
		expect(closed[0]).toMatchObject({ status: "closed", closedAt: 5_000 });
		// The other command's debt is untouched — green here proves nothing there.
		expect(records.filter((record) => record.status === "open").map((record) => record.command)).toEqual([
			"npm run typecheck",
		]);
	});

	it("briefs the architect to FIX open debt, and says nothing when nothing is owed", () => {
		expect(describeInheritedDebtForPlanning([])).toBe("");
		const closedOnly: InheritedDebtRecord[] = foldInheritedDebtSighting([], sight()).map((record) => ({
			...record,
			status: "closed" as const,
			closedAt: 1,
		}));
		expect(describeInheritedDebtForPlanning(closedOnly)).toBe("");

		const brief = describeInheritedDebtForPlanning(foldInheritedDebtSighting([], sight()));
		expect(brief).toContain("must plan to FIX");
		expect(brief).toContain("npm test");
		expect(brief).toContain("conservation violated");
		// It must forbid the three ways a plan pretends to handle it.
		expect(brief).toContain("Do not plan around it");
		expect(brief).toContain("do not weaken the command");
		expect(brief).toContain("do not mark it out of scope");
		// Stack frames are noise, not evidence the architect needs.
		expect(brief).not.toContain("at Object.<anonymous>");
	});
});
