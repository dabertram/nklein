import { describe, expect, it } from "vitest";
import { probeLocalGpuCeiling, type SysctlExec } from "../../src/core/apple-silicon-probe";

const GB = 1024 * 1024 * 1024;

/** Build a fake `sysctl -n <key>` that answers from a map; unknown keys exit non-zero like the real thing. */
function fakeSysctl(values: Record<string, string>): SysctlExec {
	return async (file, args) => {
		expect(file).toBe("sysctl");
		const key = args[args.length - 1];
		if (!(key in values)) {
			throw new Error(`sysctl: unknown oid '${key}'`);
		}
		return { stdout: `${values[key]}\n`, stderr: "" };
	};
}

describe("probeLocalGpuCeiling", () => {
	it("returns the default-cap ceiling on an Apple-Silicon Mac with no explicit limit", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 128 * GB,
			exec: fakeSysctl({ "hw.optional.arm64": "1", "iogpu.wired_limit_mb": "0" }),
		});
		expect(result?.usableBytes).toBe(Math.floor(128 * GB * 0.75));
		expect(result?.raised).toBe(false);
		// 0 is macOS's "use the default" sentinel — it must not be reported as an explicit configured 0.
		expect(result?.wiredLimitMb).toBeNull();
	});

	it("reports a raised ceiling when the limit is explicitly set", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 128 * GB,
			exec: fakeSysctl({ "hw.optional.arm64": "1", "iogpu.wired_limit_mb": `${112 * 1024}` }),
		});
		expect(result?.usableBytes).toBe(112 * GB);
		expect(result?.raised).toBe(true);
	});

	it("returns null off darwin without running any command", async () => {
		let called = false;
		const result = await probeLocalGpuCeiling({
			platform: "linux",
			exec: async () => {
				called = true;
				return { stdout: "", stderr: "" };
			},
		});
		expect(result).toBeNull();
		expect(called).toBe(false);
	});

	it("returns null on an Intel Mac — this ceiling does not describe its VRAM", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 64 * GB,
			exec: fakeSysctl({ "hw.optional.arm64": "0" }),
		});
		expect(result).toBeNull();
	});

	it("returns null — never a zero ceiling — when sysctl fails outright", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 64 * GB,
			exec: async () => {
				throw new Error("sysctl exploded");
			},
		});
		expect(result).toBeNull();
	});

	it("still yields a ceiling when the wired-limit key is absent but the host is Apple Silicon", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 64 * GB,
			exec: fakeSysctl({ "hw.optional.arm64": "1" }),
		});
		expect(result?.usableBytes).toBe(Math.floor(64 * GB * 0.75));
	});

	it("returns null when physical memory reads as nonsense", async () => {
		const result = await probeLocalGpuCeiling({
			platform: "darwin",
			totalRamBytes: 0,
			exec: fakeSysctl({ "hw.optional.arm64": "1", "iogpu.wired_limit_mb": "0" }),
		});
		expect(result).toBeNull();
	});
});
