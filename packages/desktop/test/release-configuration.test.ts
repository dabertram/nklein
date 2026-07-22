import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

describe("desktop release configuration", () => {
	it("defines deterministic cross-platform artifact names and the fail-closed preflight hook", () => {
		const config = readFileSync(resolve(PACKAGE_ROOT, "electron-builder.yml"), "utf8");
		expect(config).toContain("beforePack: ./scripts/release-policy.cjs");
		expect(config).toContain('artifactName: "${productName}-${version}-${arch}.${ext}"');
		expect(config).toContain('artifactName: "${productName}-${version}-windows-${arch}-setup.${ext}"');
		expect(config).toContain('artifactName: "${productName}-${version}-linux-${arch}.${ext}"');
		expect(config).toContain("target: nsis");
		expect(config).toContain("target: AppImage");
		expect(config).toContain("target: deb");
	});

	it("pins every release action and retains provenance/signature verification gates", () => {
		const workflow = readFileSync(resolve(REPO_ROOT, ".github/workflows/desktop-release.yml"), "utf8");
		expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/u);
		expect(workflow).toContain("npm ci --no-audit --no-fund");
		expect(workflow).toContain("codesign --verify --deep --strict");
		expect(workflow).toContain("Get-AuthenticodeSignature");
		expect(workflow).toContain("NKLEIN_RELEASE_MANIFEST_PRIVATE_KEY");
		expect(workflow).toContain("actions/attest@");
		expect(workflow).toContain("--signed-platforms darwin,win32");
		expect(workflow).toContain("--notarized-platforms darwin");
	});
});
