import { describe, expect, it } from "vitest";
import { buildAuditDetail } from "../../../src/chat/chat-audit-detail";

describe("buildAuditDetail", () => {
	// -------------------------------------------------------------------------
	// run_command
	// -------------------------------------------------------------------------
	describe("run_command", () => {
		it("records the actual command string", () => {
			expect(buildAuditDetail("run_command", { command: "npm test" })).toBe("npm test");
		});

		it("includes cwd when present", () => {
			expect(buildAuditDetail("run_command", { command: "npm run build", cwd: "packages/core" })).toBe(
				"npm run build (cwd: packages/core)",
			);
		});

		it("falls back to tool name when command is empty", () => {
			expect(buildAuditDetail("run_command", { command: "" })).toBe("run_command");
			expect(buildAuditDetail("run_command", {})).toBe("run_command");
		});

		it("masks --token= flag values", () => {
			const detail = buildAuditDetail("run_command", { command: "curl https://example.com --token=abc123secret" });
			expect(detail).not.toContain("abc123secret");
			expect(detail).toContain("--token=…");
		});

		it("masks --password= flag values", () => {
			const detail = buildAuditDetail("run_command", { command: "deploy --password=hunter2 --env=prod" });
			expect(detail).not.toContain("hunter2");
			expect(detail).toContain("--password=…");
			// Non-secret flags are preserved
			expect(detail).toContain("--env=prod");
		});

		it("masks --secret= flag values", () => {
			const detail = buildAuditDetail("run_command", { command: "ci-tool --secret=supersecretvalue" });
			expect(detail).not.toContain("supersecretvalue");
			expect(detail).toContain("--secret=…");
		});

		it("masks Authorization header values", () => {
			const detail = buildAuditDetail("run_command", {
				command: "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'",
			});
			expect(detail).not.toContain("eyJhbGciOiJIUzI1NiJ9");
			expect(detail).toContain("Authorization:");
		});

		it("masks TOKEN=value env-var assignments", () => {
			const detail = buildAuditDetail("run_command", { command: "TOKEN=mysecrettoken npm run deploy" });
			expect(detail).not.toContain("mysecrettoken");
			expect(detail).toContain("TOKEN=…");
		});

		it("masks API_KEY= env-var assignments", () => {
			const detail = buildAuditDetail("run_command", { command: "API_KEY=sk-ant-abcdefghijklmnop npm run check" });
			expect(detail).not.toContain("sk-ant-abcdefghijklmnop");
			expect(detail).toContain("API_KEY=…");
		});

		it("does not mask benign short command tokens", () => {
			// A normal short argument like a file name or flag should not be masked.
			const detail = buildAuditDetail("run_command", { command: "git log --oneline -n 5" });
			expect(detail).toBe("git log --oneline -n 5");
		});

		it("truncates very long commands to the cap", () => {
			const longCmd = `npm run build ${"x".repeat(600)}`;
			const detail = buildAuditDetail("run_command", { command: longCmd });
			expect(detail.length).toBeLessThanOrEqual(513); // 512 chars + ellipsis char
			expect(detail.endsWith("…")).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// browse_url
	// -------------------------------------------------------------------------
	describe("browse_url", () => {
		it("records the URL", () => {
			expect(buildAuditDetail("browse_url", { url: "https://example.com/path" })).toBe("https://example.com/path");
		});

		it("falls back to tool name when url is missing", () => {
			expect(buildAuditDetail("browse_url", {})).toBe("browse_url");
		});

		it("falls back to tool name when url is empty", () => {
			expect(buildAuditDetail("browse_url", { url: "" })).toBe("browse_url");
		});
	});

	// -------------------------------------------------------------------------
	// File / path tools
	// -------------------------------------------------------------------------
	describe("write_file / edit_file / read_file / list_dir / read_large_file", () => {
		for (const toolName of ["write_file", "edit_file", "read_file", "list_dir", "read_large_file"] as const) {
			it(`${toolName}: records the workspace-relative path`, () => {
				expect(buildAuditDetail(toolName, { path: "src/app.ts" })).toBe(`${toolName}: src/app.ts`);
			});

			it(`${toolName}: falls back to tool name when path is empty`, () => {
				expect(buildAuditDetail(toolName, {})).toBe(toolName);
			});

			it(`${toolName}: does NOT log a host-absolute path (POSIX)`, () => {
				const detail = buildAuditDetail(toolName, { path: "/private/var/folders/tmp/nklein-xyz/src/app.ts" });
				// Must fall back to the tool name — never expose the host path.
				expect(detail).toBe(toolName);
				expect(detail).not.toContain("/private");
				expect(detail).not.toContain("/var/folders");
			});

			it(`${toolName}: does NOT log a host-absolute path (Windows-style)`, () => {
				const detail = buildAuditDetail(toolName, { path: "C:\\Users\\david\\projects\\app.ts" });
				expect(detail).toBe(toolName);
				expect(detail).not.toContain("C:");
			});
		}
	});

	// -------------------------------------------------------------------------
	// Unknown tools — fallback
	// -------------------------------------------------------------------------
	describe("unknown tools", () => {
		it("falls back to the tool name for unknown tools", () => {
			expect(buildAuditDetail("some_future_tool", { anything: 42 })).toBe("some_future_tool");
		});

		it("falls back to the tool name for board tools with no meaningful detail", () => {
			expect(buildAuditDetail("get_board_state", {})).toBe("get_board_state");
		});
	});
});
