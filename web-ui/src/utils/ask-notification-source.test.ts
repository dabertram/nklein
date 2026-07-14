import { describe, expect, it } from "vitest";
import { deriveActionableAsks, type OperatorInboxAsks, planAskNotifications } from "@/utils/ask-notification-source";

const EMPTY_INBOX: OperatorInboxAsks = {
	clarifyingQuestions: [],
	escalatedToOperator: [],
	heldDeliveries: [],
	protectedWrites: [],
	blockedOnSetup: [],
};

describe("deriveActionableAsks (F2.15b)", () => {
	it("maps each inbox list to its ASK kind with a taskId-plus-kind dedupe key", () => {
		const asks = deriveActionableAsks({
			...EMPTY_INBOX,
			clarifyingQuestions: ["t1"],
			escalatedToOperator: ["t2"],
			heldDeliveries: ["t3"],
			blockedOnSetup: ["t4"],
		});
		expect(asks).toEqual([
			{ taskId: "t1", kind: "needs_input", dedupeKey: "t1:needs_input" },
			{ taskId: "t2", kind: "escalated_to_operator", dedupeKey: "t2:escalated_to_operator" },
			{ taskId: "t3", kind: "delivery_gate_held", dedupeKey: "t3:delivery_gate_held" },
			{ taskId: "t4", kind: "blocked", dedupeKey: "t4:blocked" },
		]);
	});

	it("collapses a held delivery + protected-write hold on the same card to ONE delivery_gate_held ask", () => {
		const asks = deriveActionableAsks({
			...EMPTY_INBOX,
			heldDeliveries: ["t1"],
			protectedWrites: ["t1"],
		});
		expect(asks).toEqual([{ taskId: "t1", kind: "delivery_gate_held", dedupeKey: "t1:delivery_gate_held" }]);
	});

	it("returns nothing for an empty inbox", () => {
		expect(deriveActionableAsks(EMPTY_INBOX)).toEqual([]);
	});
});

describe("planAskNotifications (F2.15b)", () => {
	const asks = deriveActionableAsks({
		...EMPTY_INBOX,
		clarifyingQuestions: ["t1"],
		blockedOnSetup: ["t2"],
	});
	const base = {
		permission: "granted" as const,
		ownerVisible: false,
		muted: false,
		quiet: false,
		alreadyNotifiedKeys: new Set<string>(),
	};

	it("fires every actionable ask when the gates pass and none was notified before", () => {
		const plan = planAskNotifications(asks, base);
		expect(plan.toFire.map((ask) => ask.dedupeKey)).toEqual(["t1:needs_input", "t2:blocked"]);
		expect([...plan.nextNotifiedKeys].sort()).toEqual(["t1:needs_input", "t2:blocked"]);
	});

	it("does not re-fire an ask already notified and still active, but carries it forward", () => {
		const plan = planAskNotifications(asks, {
			...base,
			alreadyNotifiedKeys: new Set(["t1:needs_input"]),
		});
		expect(plan.toFire.map((ask) => ask.dedupeKey)).toEqual(["t2:blocked"]);
		expect([...plan.nextNotifiedKeys].sort()).toEqual(["t1:needs_input", "t2:blocked"]);
	});

	it("prunes a notified key whose ask is no longer present (so a recurrence re-fires)", () => {
		// t1 was notified last tick but is gone now; only t2 is active → t1 drops from the carried-forward set.
		const onlyBlocked = asks.filter((ask) => ask.kind === "blocked");
		const plan = planAskNotifications(onlyBlocked, {
			...base,
			alreadyNotifiedKeys: new Set(["t1:needs_input", "t2:blocked"]),
		});
		expect(plan.toFire).toEqual([]);
		expect([...plan.nextNotifiedKeys]).toEqual(["t2:blocked"]);
	});

	it("fires nothing when the owning view is visible, permission is denied, or the session is muted", () => {
		expect(planAskNotifications(asks, { ...base, ownerVisible: true }).toFire).toEqual([]);
		expect(planAskNotifications(asks, { ...base, permission: "denied" }).toFire).toEqual([]);
		expect(planAskNotifications(asks, { ...base, muted: true }).toFire).toEqual([]);
	});

	it("quiet mode suppresses the soft needs_input ask but keeps the hard blocked ask", () => {
		const plan = planAskNotifications(asks, { ...base, quiet: true });
		expect(plan.toFire.map((ask) => ask.dedupeKey)).toEqual(["t2:blocked"]);
	});
});
