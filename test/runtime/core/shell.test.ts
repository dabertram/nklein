import { afterEach, describe, expect, it } from "vitest";
import { buildShellCommandLine, quoteShellArg, resolveInteractiveShellCommand } from "../../../src/core/shell";

// The win32 branch can't be exercised off-Windows (it reads process.platform); these assert the POSIX behavior,
// which is identical on the darwin dev box and Linux CI.
const onPosix = process.platform !== "win32";

describe.skipIf(!onPosix)("quoteShellArg (POSIX)", () => {
	it("single-quotes a plain arg", () => {
		expect(quoteShellArg("foo")).toBe("'foo'");
	});

	it("escapes embedded single quotes with the '\\'' idiom", () => {
		expect(quoteShellArg("it's")).toBe("'it'\\''s'");
	});
});

describe.skipIf(!onPosix)("buildShellCommandLine (POSIX)", () => {
	it("quotes every part and space-joins", () => {
		expect(buildShellCommandLine("bash", ["-i"])).toBe("'bash' '-i'");
		expect(buildShellCommandLine("/bin/zsh", ["-c", "echo hi"])).toBe("'/bin/zsh' '-c' 'echo hi'");
	});
});

describe.skipIf(!onPosix)("resolveInteractiveShellCommand (POSIX)", () => {
	const savedShell = process.env.SHELL;
	afterEach(() => {
		if (savedShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = savedShell;
		}
	});

	it("uses $SHELL interactively when set", () => {
		process.env.SHELL = "/bin/zsh";
		expect(resolveInteractiveShellCommand()).toEqual({ binary: "/bin/zsh", args: ["-i"] });
	});

	it("falls back to interactive bash when $SHELL is unset", () => {
		delete process.env.SHELL;
		expect(resolveInteractiveShellCommand()).toEqual({ binary: "bash", args: ["-i"] });
	});
});
