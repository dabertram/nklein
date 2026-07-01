import { describe, expect, it } from "vitest";
import {
	isLmStudioHostObservable,
	type ModelLiveness,
	probeModelResidency,
	shouldAbortForLostResidency,
} from "../../../src/core/lmstudio-liveness";

/** A fetch stub: either throws (network error) or returns a Response-like with the given ok + json payload. */
function stubFetch(opts: { ok?: boolean; payload?: unknown; throws?: boolean }): typeof fetch {
	return (async () => {
		if (opts.throws) {
			throw new Error("network down");
		}
		return {
			ok: opts.ok ?? true,
			json: async () => opts.payload ?? {},
		} as Response;
	}) as unknown as typeof fetch;
}

const BASE_URL = "http://127.0.0.1:1234/v1";

describe("probeModelResidency", () => {
	it("'resident' — LM Studio reachable and the model is loaded", async () => {
		const fetchImpl = stubFetch({
			payload: {
				data: [
					{ id: "qwopus", state: "loaded" },
					{ id: "other", state: "not-loaded" },
				],
			},
		});
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("resident");
	});

	it("'absent' — LM Studio reachable but the model is NOT in the loaded set (crashed / unloaded)", async () => {
		const fetchImpl = stubFetch({ payload: { data: [{ id: "other", state: "loaded" }] } });
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("absent");
	});

	it("'absent' — the model is listed but not-loaded (only `loaded` counts as resident)", async () => {
		const fetchImpl = stubFetch({ payload: { data: [{ id: "qwopus", state: "not-loaded" }] } });
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("absent");
	});

	it("'unobservable' — a non-OK response (404 ⇒ not LM Studio's native API)", async () => {
		const fetchImpl = stubFetch({ ok: false, payload: { error: "not found" } });
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("unobservable");
	});

	it("'unobservable' — the request throws (unreachable / network error)", async () => {
		const fetchImpl = stubFetch({ throws: true });
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("unobservable");
	});

	it("'unobservable' — reachable but NOT the LM Studio native shape (no `data` array)", async () => {
		const fetchImpl = stubFetch({ payload: { object: "list", models: ["qwopus"] } });
		expect(await probeModelResidency(BASE_URL, "qwopus", fetchImpl)).toBe("unobservable");
	});
});

describe("isLmStudioHostObservable", () => {
	it("true when the host gives a definite verdict (resident or absent)", async () => {
		expect(
			await isLmStudioHostObservable(
				BASE_URL,
				"qwopus",
				stubFetch({ payload: { data: [{ id: "qwopus", state: "loaded" }] } }),
			),
		).toBe(true);
		expect(await isLmStudioHostObservable(BASE_URL, "qwopus", stubFetch({ payload: { data: [] } }))).toBe(true);
	});

	it("false when the host is not LM Studio / unreachable (unobservable)", async () => {
		expect(await isLmStudioHostObservable(BASE_URL, "qwopus", stubFetch({ throws: true }))).toBe(false);
		expect(await isLmStudioHostObservable(BASE_URL, "qwopus", stubFetch({ ok: false }))).toBe(false);
	});
});

describe("shouldAbortForLostResidency", () => {
	const p = (...probes: ModelLiveness[]) => probes;

	it("aborts when a confirmed-resident model goes absent for the required consecutive probes", () => {
		expect(shouldAbortForLostResidency(p("resident", "absent", "absent"), { absentConfirmations: 2 })).toBe(true);
		expect(shouldAbortForLostResidency(p("resident", "absent"), { absentConfirmations: 1 })).toBe(true);
	});

	it("holds (no abort) until enough consecutive absents accumulate", () => {
		expect(shouldAbortForLostResidency(p("resident", "absent"), { absentConfirmations: 2 })).toBe(false);
	});

	it("never aborts on a transient blip — an `unobservable` probe breaks the trailing-absent run", () => {
		// last probe couldn't confirm death ⇒ don't abort even though earlier probes were absent
		expect(shouldAbortForLostResidency(p("resident", "absent", "unobservable"), { absentConfirmations: 1 })).toBe(
			false,
		);
		// a resident probe in the middle also resets
		expect(
			shouldAbortForLostResidency(p("resident", "absent", "resident", "absent"), { absentConfirmations: 2 }),
		).toBe(false);
	});

	it("never aborts without POSITIVE prior residency (an unobservable host must fall back to the timeout)", () => {
		expect(shouldAbortForLostResidency(p("absent", "absent", "absent"), { absentConfirmations: 1 })).toBe(false);
		expect(shouldAbortForLostResidency(p("unobservable", "unobservable"), { absentConfirmations: 1 })).toBe(false);
		expect(shouldAbortForLostResidency(p(), { absentConfirmations: 1 })).toBe(false);
	});

	it("clamps the confirmations floor to 1", () => {
		expect(shouldAbortForLostResidency(p("resident", "absent"), { absentConfirmations: 0 })).toBe(true);
	});
});
