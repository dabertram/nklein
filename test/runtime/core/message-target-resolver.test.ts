import { describe, expect, it } from "vitest";
import {
	type MessageTargetIndex,
	type OutstandingAsk,
	type ResolveMessageTargetInput,
	resolveMessageTarget,
} from "../../../src/core/message-target-resolver";

const index: MessageTargetIndex = {
	cards: [
		{ id: "c1", title: "Auth refactor", streamId: "s1" },
		{ id: "c2", title: "DB migration", streamId: "s1" },
		{ id: "dup", title: "Shared" },
		{ id: "dup2", title: "Shared" },
	],
	streams: [
		{ id: "s1", title: "Auth stream" },
		{ id: "s2", title: "Billing" },
	],
};

function input(over: Partial<ResolveMessageTargetInput> = {}): ResolveMessageTargetInput {
	return { text: "do the thing", outstandingAsks: [], focus: null, index, ...over };
}

const ask = (over: Partial<OutstandingAsk> & { taskId: string }): OutstandingAsk => ({
	signalKey: `${over.taskId}:needs_input`,
	question: `Q for ${over.taskId}`,
	...over,
});

describe("resolveMessageTarget — rung 1: explicit handle", () => {
	it("routes @card:<id> to that card (high confidence)", () => {
		const t = resolveMessageTarget(input({ text: "use the new api @card:c1" }));
		expect(t.kind).toBe("card");
		expect(t.id).toBe("c1");
		expect(t.source).toBe("explicit_handle");
		expect(t.displayLabel).toContain("Auth refactor");
	});

	it("routes @stream:<id> to that stream", () => {
		expect(resolveMessageTarget(input({ text: "@stream:s2 pause everything" }))).toMatchObject({
			kind: "stream",
			id: "s2",
		});
	});

	it("routes @<title-slug> to a uniquely-matching card", () => {
		expect(resolveMessageTarget(input({ text: "@db-migration rerun it" }))).toMatchObject({ kind: "card", id: "c2" });
	});

	it("routes @<title-slug> to a uniquely-matching stream", () => {
		expect(resolveMessageTarget(input({ text: "status of @billing?" }))).toMatchObject({ kind: "stream", id: "s2" });
	});

	it("needs_clarify when a slug matches multiple targets", () => {
		const t = resolveMessageTarget(input({ text: "@shared do x" }));
		expect(t.kind).toBe("needs_clarify");
		expect(t.candidates?.length).toBe(2);
	});

	it("falls through when a @card:<id> handle names an unknown id", () => {
		// No such card ⇒ not an explicit target; falls to the default goal.
		expect(resolveMessageTarget(input({ text: "@card:nope hi" })).kind).toBe("goal");
	});

	it("an explicit handle BEATS an outstanding ASK and a focus (precedence)", () => {
		const t = resolveMessageTarget(
			input({
				text: "@card:c1 actually do this",
				outstandingAsks: [ask({ taskId: "c2" })],
				focus: { kind: "stream", id: "s2" },
			}),
		);
		expect(t).toMatchObject({ kind: "card", id: "c1", source: "explicit_handle" });
	});
});

describe("resolveMessageTarget — rung 2: reply-bind to a pending ASK", () => {
	it("binds a reply to the single outstanding ASK (answer + pendingKey)", () => {
		const t = resolveMessageTarget(input({ text: "yes, use postgres", outstandingAsks: [ask({ taskId: "c2" })] }));
		expect(t.kind).toBe("answer");
		expect(t.id).toBe("c2");
		expect(t.pendingKey).toBe("c2:needs_input");
		expect(t.displayLabel).toContain("answering");
	});

	it("binds to the focus-scoped ASK when several are outstanding", () => {
		const t = resolveMessageTarget(
			input({
				text: "go with option B",
				outstandingAsks: [ask({ taskId: "c1" }), ask({ taskId: "c2" })],
				focus: { kind: "card", id: "c2" },
			}),
		);
		expect(t).toMatchObject({ kind: "answer", id: "c2" });
	});

	it("binds to the last-referenced card's ASK when focus is not a card", () => {
		const t = resolveMessageTarget(
			input({
				text: "approved",
				outstandingAsks: [ask({ taskId: "c1" }), ask({ taskId: "c2" })],
				lastReferencedTaskId: "c1",
			}),
		);
		expect(t).toMatchObject({ kind: "answer", id: "c1" });
	});

	it("needs_clarify when multiple ASKs are outstanding and none is focus-scoped", () => {
		const t = resolveMessageTarget(
			input({ text: "ok", outstandingAsks: [ask({ taskId: "c1" }), ask({ taskId: "c2" })] }),
		);
		expect(t.kind).toBe("needs_clarify");
		expect(t.candidates?.every((c) => c.kind === "answer")).toBe(true);
		expect(t.candidates?.length).toBe(2);
	});
});

describe("resolveMessageTarget — rung 3: focus, and rung 4: goal default", () => {
	it("targets the focused card when no handle/ASK applies", () => {
		expect(resolveMessageTarget(input({ text: "keep going", focus: { kind: "card", id: "c1" } }))).toMatchObject({
			kind: "card",
			id: "c1",
			source: "focus",
			confidence: "medium",
		});
	});

	it("targets the focused stream", () => {
		expect(
			resolveMessageTarget(input({ text: "prioritize this", focus: { kind: "stream", id: "s1" } })),
		).toMatchObject({
			kind: "stream",
			id: "s1",
			source: "focus",
		});
	});

	it("defaults to the goal when nothing else applies", () => {
		const t = resolveMessageTarget(input({ text: "let's build a login page" }));
		expect(t).toMatchObject({ kind: "goal", source: "default", displayLabel: "Goal" });
	});

	it("a reply-bind BEATS a focus (a pending answer wins over the drilled-in view)", () => {
		const t = resolveMessageTarget(
			input({
				text: "yes",
				outstandingAsks: [ask({ taskId: "c1" })],
				focus: { kind: "stream", id: "s2" },
			}),
		);
		expect(t.kind).toBe("answer");
	});
});
