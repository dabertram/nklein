import { describe, expect, it } from "vitest";

import {
	buildDiscoveredModelSourceUrls,
	normalizeDiscoveryBaseUrl,
	normalizeLmStudioModelListBaseUrl,
} from "../../../src/nklein-agent/nklein-provider-discovery-urls";

describe("normalizeDiscoveryBaseUrl", () => {
	it("strips trailing slashes", () => {
		expect(normalizeDiscoveryBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
	});

	it("strips an /embeddings suffix (so an embedding base URL discovers chat models too)", () => {
		expect(normalizeDiscoveryBaseUrl("http://localhost:1234/v1/embeddings")).toBe("http://localhost:1234/v1");
	});

	it("drops query and hash", () => {
		expect(normalizeDiscoveryBaseUrl("http://localhost:1234/v1?key=secret#frag")).toBe("http://localhost:1234/v1");
	});

	it("falls back to a string strip for an unparseable URL", () => {
		expect(normalizeDiscoveryBaseUrl("not a url/embeddings")).toBe("not a url");
	});

	it("does NOT strip /v1 (that is the LM Studio helper's job)", () => {
		expect(normalizeDiscoveryBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
	});
});

describe("normalizeLmStudioModelListBaseUrl", () => {
	it("strips a trailing /v1 (LM Studio's REST model list is at the host root)", () => {
		expect(normalizeLmStudioModelListBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234");
		expect(normalizeLmStudioModelListBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234");
	});

	it("leaves a base URL without /v1 untouched (minus trailing slash)", () => {
		expect(normalizeLmStudioModelListBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234");
	});

	it("falls back to a string strip for an unparseable URL", () => {
		expect(normalizeLmStudioModelListBaseUrl("garbage/v1")).toBe("garbage");
	});
});

describe("buildDiscoveredModelSourceUrls", () => {
	it("expands a /v1 base URL into the known model-list endpoints", () => {
		const urls = buildDiscoveredModelSourceUrls({ baseUrl: "http://localhost:1234/v1" });
		expect(urls).toContain("http://localhost:1234/v1/models");
		expect(urls).toContain("http://localhost:1234/api/v1/models");
		expect(urls).toContain("http://localhost:1234/api/v0/models");
	});

	it("puts an explicit modelsSourceUrl first", () => {
		const urls = buildDiscoveredModelSourceUrls({
			baseUrl: "http://localhost:1234/v1",
			modelsSourceUrl: "http://custom/models",
		});
		expect(urls[0]).toBe("http://custom/models");
	});

	it("uses a base URL that already points at a models endpoint as-is (no path joining)", () => {
		const urls = buildDiscoveredModelSourceUrls({ baseUrl: "http://localhost:1234/v1/models" });
		expect(urls).toContain("http://localhost:1234/v1/models");
		// It did not also fabricate a nested /v1/models/models candidate.
		expect(urls).not.toContain("http://localhost:1234/v1/models/models");
	});

	it("de-duplicates candidates", () => {
		const urls = buildDiscoveredModelSourceUrls({ baseUrl: "http://localhost:1234/v1" });
		expect(urls.length).toBe(new Set(urls).size);
	});
});
