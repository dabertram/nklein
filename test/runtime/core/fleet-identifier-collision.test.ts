import { describe, expect, it } from "vitest";
import {
	collidingIdentifiers,
	describeIdentifierCollision,
	isCollidingIdentifierRoutable,
	machinesByIdentifier,
	resetCollisionRoutabilityCacheForTests,
} from "../../../src/core/fleet-identifier-collision";

describe("fleet identifier collisions (live 2026-09-04: legion + M1 both served dirk-qwen3.8-27b)", () => {
	const fleet = [
		{ identifier: "dirk-qwen3.8-27b", machineId: "legion5pro" },
		{ identifier: "dirk-qwen3.8-27b", machineId: "ABT-C-00335" },
		{ identifier: "dirk-qwen3.8-27b@q2_k_xl", machineId: "m4mini" },
		{ identifier: "qwen3.8-flash-next", machineId: "local" },
		// The same identifier twice on ONE machine (two instances) is not a cross-host collision.
		{ identifier: "ornith-local-9b", machineId: "local" },
		{ identifier: "ornith-local-9b", machineId: "local" },
	];

	it("groups machines per identifier and flags only cross-host duplicates", () => {
		const grouped = machinesByIdentifier(fleet);
		expect([...(grouped.get("dirk-qwen3.8-27b") ?? [])].sort()).toEqual(["ABT-C-00335", "legion5pro"]);
		expect(grouped.get("ornith-local-9b")?.size).toBe(1);
		expect([...collidingIdentifiers(fleet)]).toEqual(["dirk-qwen3.8-27b"]);
		expect(collidingIdentifiers([]).size).toBe(0);
	});

	it("describes the collision with the hosts and the rename recipe", () => {
		const text = describeIdentifierCollision("dirk-qwen3.8-27b", fleet);
		expect(text).toContain("2 LM-Link hosts");
		expect(text).toContain("legion5pro");
		expect(text).toContain("ABT-C-00335");
		expect(text).toContain("--identifier dirk-qwen3.8-27b@<host>");
	});
});

describe("isCollidingIdentifierRoutable (evidence-based exclusion, David 2026-09-05 'use all available compute')", () => {
	it("routes when a 1-token gateway probe succeeds, refuses when it fails, and caches per identifier", async () => {
		resetCollisionRoutabilityCacheForTests();
		const calls: string[] = [];
		const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { model: string; max_tokens: number };
			calls.push(`${url} ${body.model} ${body.max_tokens}`);
			return new Response(body.model === "good" ? "{}" : "nope", { status: body.model === "good" ? 200 : 500 });
		}) as unknown as typeof fetch;
		await expect(isCollidingIdentifierRoutable("good", "http://gw/v1", { fetchImpl, nowMs: 1_000 })).resolves.toBe(
			true,
		);
		await expect(isCollidingIdentifierRoutable("bad", "http://gw/v1", { fetchImpl, nowMs: 1_000 })).resolves.toBe(
			false,
		);
		// Cached inside the TTL: no second probe for either identifier.
		await expect(isCollidingIdentifierRoutable("good", "http://gw/v1", { fetchImpl, nowMs: 2_000 })).resolves.toBe(
			true,
		);
		await expect(isCollidingIdentifierRoutable("bad", "http://gw/v1", { fetchImpl, nowMs: 2_000 })).resolves.toBe(
			false,
		);
		expect(calls).toEqual(["http://gw/v1/chat/completions good 1", "http://gw/v1/chat/completions bad 1"]);
		// A throwing fetch is a refusal, never an exception.
		resetCollisionRoutabilityCacheForTests();
		const throwing = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		await expect(isCollidingIdentifierRoutable("good", "http://gw/v1", { fetchImpl: throwing })).resolves.toBe(false);
	});
});
