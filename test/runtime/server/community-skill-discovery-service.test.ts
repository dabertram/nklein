import { describe, expect, it, vi } from "vitest";
import { createCommunitySkillDiscoveryService } from "../../../src/server/community-skill-discovery-service";

describe("community skill discovery service", () => {
	it("inherits the egress broker's fail-closed gate before any network request", async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const service = createCommunitySkillDiscoveryService({
			backendBaseUrl: "http://search.local:8080",
			egressEnabled: false,
			fetchImpl,
		});
		const response = await service.discover({ query: "typescript" });

		expect(fetchImpl).not.toHaveBeenCalled();
		expect(response.results).toEqual([]);
		expect(response.failures.every((failure) => failure.code === "blocked_by_egress")).toBe(true);
	});

	it("uses only the broker's configured backend and never fetches a discovered URL", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			const backendUrl = String(input);
			expect(backendUrl.startsWith("http://search.local:8080/search?")).toBe(true);
			const requestedQuery = new URL(backendUrl).searchParams.get("q") ?? "";
			const scope = requestedQuery.match(/site:([^ ]+)$/)?.[1] ?? "";
			return new Response(
				JSON.stringify({ results: [{ title: "Skill", url: `https://${scope}/skill`, content: "do not inject" }] }),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
		const service = createCommunitySkillDiscoveryService({
			backendBaseUrl: "http://search.local:8080",
			egressEnabled: true,
			fetchImpl,
		});
		const response = await service.discover({ query: "typescript" });

		expect(response.results.length).toBeGreaterThan(0);
		expect(fetchImpl).toHaveBeenCalledTimes(3);
		expect(JSON.stringify(response)).not.toContain("do not inject");
	});
});
