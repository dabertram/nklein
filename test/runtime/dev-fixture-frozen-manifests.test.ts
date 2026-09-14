import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FROZEN_MANIFEST_PATHS, parseFrozenManifestPaths } from "../../src/core/frozen-evidence-guard";

/**
 * P1.SELFGRADED — every contract fixture declares what is frozen.
 *
 * The acceptance verifier's frozen-evidence guard can only hold a delivery to a manifest that exists on its base
 * commit. A fixture shipped without one is graded by files its agent can rewrite, which is where 40 fixtures stood
 * until 2026-09-14. So a fixture cannot land without a manifest naming every grader it ships and its runner, and a
 * manifest cannot drift from the bytes it describes.
 */

const FIXTURES_ROOT = "scripts/dev-fixtures";

/** Build fixtures: the agent writes the tests there, so there is no grader to freeze. */
const AGENT_AUTHORED_TEST_FIXTURES = new Set(["smoke-ts-cli", "ts-starter"]);

function contractFixtures(): string[] {
	return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(FIXTURES_ROOT, entry.name, "scripts", "run-tests.mjs")))
		.map((entry) => entry.name)
		.filter((name) => !AGENT_AUTHORED_TEST_FIXTURES.has(name))
		.sort();
}

describe("dev-fixture frozen manifests", () => {
	it("finds the contract fixtures at all", () => {
		// An empty list would pass every case below by vacuity.
		expect(contractFixtures().length).toBeGreaterThanOrEqual(40);
	});

	it.each(
		contractFixtures(),
	)("%s ships a manifest that freezes its graders and runner, with current digests", (fixture) => {
		const root = join(FIXTURES_ROOT, fixture);
		const manifests = FROZEN_MANIFEST_PATHS.filter((path) => existsSync(join(root, path)));
		expect(manifests, `${fixture} ships no frozen manifest`).toHaveLength(1);
		const manifest = manifests[0] as string;
		const text = readFileSync(join(root, manifest), "utf8");
		const paths = parseFrozenManifestPaths(text) ?? [];
		expect(paths.length, `${fixture}'s ${manifest} declares nothing`).toBeGreaterThan(0);

		const graders = readdirSync(join(root, "test"))
			.filter((name) => /\.test\.(js|ts)$/.test(name))
			.map((name) => `test/${name}`);
		for (const path of [...graders, "scripts/run-tests.mjs"]) {
			expect(paths, `${fixture} does not freeze ${path}`).toContain(path);
		}

		const parsed = JSON.parse(text) as { frozen?: Record<string, string> } & Record<string, unknown>;
		const digests = (parsed.frozen ?? parsed) as Record<string, unknown>;
		for (const path of paths) {
			expect(
				existsSync(join(root, path)),
				`${fixture}'s manifest lists ${path}, which the fixture does not ship`,
			).toBe(true);
			const actual = createHash("sha256")
				.update(readFileSync(join(root, path)))
				.digest("hex");
			expect(digests[path], `${fixture}'s manifest records a stale digest for ${path}`).toBe(actual);
		}
	});
});
