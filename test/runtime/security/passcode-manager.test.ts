import { describe, expect, it } from "vitest";
import { stripInternalAuthTokenFromEnv } from "../../../src/security/passcode-manager";

describe("stripInternalAuthTokenFromEnv", () => {
	it("removes the current and legacy internal auth token vars, preserving everything else", () => {
		const env = {
			PATH: "/usr/bin",
			NKLEIN_INTERNAL_AUTH_TOKEN: "secret-current",
			KANBAN_INTERNAL_AUTH_TOKEN: "secret-legacy",
			HOME: "/home/x",
		};
		const scrubbed = stripInternalAuthTokenFromEnv(env);
		expect(scrubbed.NKLEIN_INTERNAL_AUTH_TOKEN).toBeUndefined();
		expect(scrubbed.KANBAN_INTERNAL_AUTH_TOKEN).toBeUndefined();
		expect(scrubbed.PATH).toBe("/usr/bin");
		expect(scrubbed.HOME).toBe("/home/x");
	});

	it("returns a copy and does not mutate the input env", () => {
		const env = { NKLEIN_INTERNAL_AUTH_TOKEN: "secret" };
		const scrubbed = stripInternalAuthTokenFromEnv(env);
		expect(env.NKLEIN_INTERNAL_AUTH_TOKEN).toBe("secret");
		expect(scrubbed).not.toBe(env);
	});

	it("is a no-op when no token is present (e.g. local loopback mode)", () => {
		const env = { PATH: "/usr/bin" };
		expect(stripInternalAuthTokenFromEnv(env)).toEqual({ PATH: "/usr/bin" });
	});
});
