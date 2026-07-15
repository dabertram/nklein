import { describe, expect, it } from "vitest";
import { screenBundleForExecutables } from "../../../src/core/skill-bundle-screening";

// Build a latin1 "head" string from raw byte values (charCodeAt(i) === byte i).
const bytes = (...values: number[]): string => String.fromCharCode(...values);

describe("screenBundleForExecutables (F4.24)", () => {
	it("clears a bundle of plain text/markdown files", () => {
		const result = screenBundleForExecutables([
			{ path: "SKILL.md", head: "# My skill\nDoes a thing." },
			{ path: "notes.txt", head: "hello world" },
		]);
		expect(result.verdict).toBe("safe");
		expect(result.files.every((file) => !file.flagged)).toBe(true);
	});

	it("quarantines on ELF / Mach-O / PE magic bytes", () => {
		const elf = screenBundleForExecutables([{ path: "payload", head: bytes(0x7f, 0x45, 0x4c, 0x46, 0x02) }]);
		expect(elf.verdict).toBe("quarantine");
		expect(elf.files[0]?.reason).toContain("ELF");

		const pe = screenBundleForExecutables([{ path: "tool", head: bytes(0x4d, 0x5a, 0x90, 0x00) }]);
		expect(pe.verdict).toBe("quarantine");

		const macho = screenBundleForExecutables([{ path: "bin", head: bytes(0xcf, 0xfa, 0xed, 0xfe) }]);
		expect(macho.verdict).toBe("quarantine");
	});

	it("quarantines a shebang script even with a .txt-looking name", () => {
		const result = screenBundleForExecutables([{ path: "install", head: "#!/bin/bash\nrm -rf /" }]);
		expect(result.verdict).toBe("quarantine");
		expect(result.files[0]?.reason).toContain("shebang");
	});

	it("quarantines an executable extension regardless of (readable) content", () => {
		const result = screenBundleForExecutables([{ path: "scripts/run.ps1", head: "Write-Host hi" }]);
		expect(result.verdict).toBe("quarantine");
		expect(result.files[0]?.reason).toContain(".ps1");
	});

	it("reports per-file verdicts so a clean file next to a bad one is still identified", () => {
		const result = screenBundleForExecutables([
			{ path: "readme.md", head: "docs" },
			{ path: "a.dylib", head: "\x00\x01" },
		]);
		expect(result.verdict).toBe("quarantine");
		expect(result.files.find((f) => f.path === "readme.md")?.flagged).toBe(false);
		expect(result.files.find((f) => f.path === "a.dylib")?.flagged).toBe(true);
	});
});
