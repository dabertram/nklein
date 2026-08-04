import { describe, expect, it } from "vitest";
import {
	buildMlxServeServeArgs,
	mlxServeDefaultBinaryPath,
	resolveMlxServeBinaryCandidates,
} from "../../../src/commands/dev-mlxserve-command";
import { normalizeKvCacheDiskGb } from "../../../src/config/runtime-config-value-helpers";

/**
 * P17.7 residency budgets — the disk budget's ENFORCEMENT path, pure pieces. The point of the setting is
 * that a number typed in Settings becomes a real `--prefix-cache-disk` flag on a real server process;
 * these pin the two halves of that flow (normalization + argv) so neither can silently detach.
 */
describe("normalizeKvCacheDiskGb", () => {
	it("accepts positive integers (truncating floats), from numbers or numeric strings", () => {
		expect(normalizeKvCacheDiskGb(16)).toBe(16);
		expect(normalizeKvCacheDiskGb(15.9)).toBe(15);
		expect(normalizeKvCacheDiskGb(" 24 ")).toBe(24);
	});

	it("normalizes everything else to null — zero, negatives, NaN, garbage, absent", () => {
		for (const value of [0, -3, Number.NaN, "not-a-number", "", null, undefined, {}]) {
			expect(normalizeKvCacheDiskGb(value)).toBeNull();
		}
	});
});

describe("buildMlxServeServeArgs", () => {
	it("always uses the serve subcommand and a hardcoded loopback host (local-only, non-negotiable)", () => {
		const args = buildMlxServeServeArgs({ modelDir: "/models", port: 11234, diskGb: null });
		expect(args[0]).toBe("serve");
		expect(args).toContain("--host");
		expect(args[args.indexOf("--host") + 1]).toBe("127.0.0.1");
	});

	it("the disk budget becomes --prefix-cache-disk <N>GB; null omits the tier entirely", () => {
		const withTier = buildMlxServeServeArgs({ modelDir: "/models", port: 11234, diskGb: 16 });
		expect(withTier).toContain("--prefix-cache-disk");
		expect(withTier[withTier.indexOf("--prefix-cache-disk") + 1]).toBe("16GB");
		const withoutTier = buildMlxServeServeArgs({ modelDir: "/models", port: 11234, diskGb: null });
		expect(withoutTier).not.toContain("--prefix-cache-disk");
	});
});

describe("resolveMlxServeBinaryCandidates", () => {
	it("orders flag > env > conventional install path, dropping blanks", () => {
		const candidates = resolveMlxServeBinaryCandidates({
			flagPath: "/explicit/mlx-serve",
			env: { NKLEIN_MLX_SERVE_BIN: "/env/mlx-serve" } as NodeJS.ProcessEnv,
			home: "/home/u",
		});
		expect(candidates).toEqual(["/explicit/mlx-serve", "/env/mlx-serve", mlxServeDefaultBinaryPath("/home/u")]);
		expect(resolveMlxServeBinaryCandidates({ env: {} as NodeJS.ProcessEnv, home: "/home/u" })).toEqual([
			mlxServeDefaultBinaryPath("/home/u"),
		]);
	});
});
