import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readEnvWithLegacyFallback, resetLegacyEnvWarningsForTests } from "../../../src/config/legacy-env";

const OPTS = { currentName: "NKLEIN_FOO", legacyName: "KANBAN_FOO" };

beforeEach(() => {
	resetLegacyEnvWarningsForTests();
});

describe("readEnvWithLegacyFallback", () => {
	it("prefers the current var and does NOT warn", () => {
		const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
		try {
			expect(readEnvWithLegacyFallback({ ...OPTS, env: { NKLEIN_FOO: "new", KANBAN_FOO: "old" } })).toBe("new");
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("falls back to the legacy var (current unset/blank) and warns once", () => {
		const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
		try {
			expect(readEnvWithLegacyFallback({ ...OPTS, env: { KANBAN_FOO: "old" } })).toBe("old");
			expect(readEnvWithLegacyFallback({ ...OPTS, env: { NKLEIN_FOO: "  ", KANBAN_FOO: "old" } })).toBe("old");
			// Deprecation warning is emitted only once per legacy name.
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain("KANBAN_FOO");
		} finally {
			warn.mockRestore();
		}
	});

	it("returns undefined when neither var is set, and trims the chosen value", () => {
		expect(readEnvWithLegacyFallback({ ...OPTS, env: {} })).toBeUndefined();
		expect(readEnvWithLegacyFallback({ ...OPTS, env: { NKLEIN_FOO: "  spaced  " } })).toBe("spaced");
	});
});

afterEach(() => {
	resetLegacyEnvWarningsForTests();
});
