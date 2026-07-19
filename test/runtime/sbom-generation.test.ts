import { describe, expect, it } from "vitest";
import { buildSbomFromLockfile, renderCycloneDxJson, renderSbomSummary } from "../../src/core/sbom-generation";

const LOCKFILE = {
	lockfileVersion: 3,
	packages: {
		"": { name: "nklein", version: "0.0.1" },
		"node_modules/alpha": { version: "1.2.3", license: "MIT", integrity: "sha512-aaa" },
		"node_modules/beta": { version: "4.0.0", integrity: "sha512-bbb" },
		"node_modules/dev-only": { version: "2.0.0", license: "Apache-2.0", integrity: "sha512-ccc", dev: true },
		"node_modules/linked": { version: "1.0.0", link: true },
		"node_modules/@scope/nested": { version: "9.9.9", license: "ISC" },
	},
};

describe("SBOM generation (F12.102)", () => {
	it("inventories components, skipping the root and workspace links", () => {
		const sbom = buildSbomFromLockfile(LOCKFILE);
		const names = sbom.components.map((component) => component.name);
		expect(names).toEqual(["@scope/nested", "alpha", "beta", "dev-only"]);
		expect(names).not.toContain("linked");
	});

	it("separates runtime from dev-only components", () => {
		const sbom = buildSbomFromLockfile(LOCKFILE);
		expect(sbom.runtimeCount).toBe(3);
		expect(sbom.devCount).toBe(1);
	});

	it("counts unknown licences and missing digests as GAPS rather than folding them away", () => {
		const sbom = buildSbomFromLockfile(LOCKFILE);
		// beta has no license; @scope/nested has no integrity.
		expect(sbom.unknownLicenseCount).toBe(1);
		expect(sbom.unverifiableCount).toBe(1);
		const summary = renderSbomSummary(sbom);
		expect(summary).toContain("1 UNKNOWN");
		expect(summary).toContain("1 WITHOUT");
		expect(summary).toContain("Unknown ≠ permissive");
	});

	it("returns an empty SBOM for unparseable input rather than a partial guess", () => {
		for (const input of [null, {}, { packages: "nope" }, 42]) {
			expect(buildSbomFromLockfile(input).components).toEqual([]);
		}
	});

	it("renders CycloneDX with scope, licences and hashes where known", () => {
		const doc = JSON.parse(renderCycloneDxJson(buildSbomFromLockfile(LOCKFILE), "nklein", "0.0.1")) as {
			bomFormat: string;
			metadata: { component: { name: string; version: string } };
			components: Array<Record<string, unknown>>;
		};
		expect(doc.bomFormat).toBe("CycloneDX");
		expect(doc.metadata.component).toMatchObject({ name: "nklein", version: "0.0.1" });

		const alpha = doc.components.find((component) => component.name === "alpha");
		expect(alpha).toMatchObject({ type: "library", version: "1.2.3", scope: "required" });
		expect(alpha?.licenses).toEqual([{ license: { id: "MIT" } }]);
		expect(alpha?.hashes).toEqual([{ alg: "SHA-512", content: "sha512-aaa" }]);

		// Dev-only components are marked excluded so a reader can tell what actually ships.
		expect(doc.components.find((component) => component.name === "dev-only")?.scope).toBe("excluded");
		// Absent fields are OMITTED rather than invented.
		expect(doc.components.find((component) => component.name === "beta")?.licenses).toBeUndefined();
	});
});
