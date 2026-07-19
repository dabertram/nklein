/**
 * F12.75 (effectful half) — probe the LOCAL machine for the Apple-Silicon GPU-wiring ceiling.
 *
 * Reads two sysctls and physical memory, then hands them to the pure {@link ./apple-silicon-vram} core. This is a
 * READ-ONLY query: it never sets `iogpu.wired_limit_mb`, because raising a wired limit is a system-settings change
 * that belongs to the operator (see the core's docblock).
 *
 * SCOPE — deliberately local-only. LM-Link exposes a remote device's RAM but not its sysctls, so a remote node's
 * ceiling is genuinely unknowable from here. Rather than assume every linked Mac runs the default cap (which would
 * be right often and catastrophically wrong on a tuned node), this returns a ceiling ONLY for the local device and
 * leaves remote candidates with no `gpuUsableBytes` — where the router treats them exactly as it always has.
 *
 * Fail-safe by construction: any probe failure yields `null`, which reads downstream as "ceiling unknown" and
 * restores the pre-F12.75 behaviour. A failed probe must never make a placement decision worse than no probe.
 */

import { execFile } from "node:child_process";
import { totalmem } from "node:os";
import { promisify } from "node:util";
import { type GpuUsableResult, gpuUsableBytes } from "./apple-silicon-vram";

const execFileAsync = promisify(execFile);

/** Minimal shape of the exec call we depend on (matches `promisify(execFile)`); injectable for tests. */
export type SysctlExec = (
	file: string,
	args: readonly string[],
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

/** Read one sysctl key as a trimmed string, or null when the key is absent / the call fails. */
async function readSysctl(key: string, exec: SysctlExec): Promise<string | null> {
	try {
		const { stdout } = await exec("sysctl", ["-n", key]);
		const value = stdout.toString().trim();
		return value.length > 0 ? value : null;
	} catch {
		// An absent key exits non-zero — that is information ("not this platform"), not an error worth surfacing.
		return null;
	}
}

export interface LocalGpuCeiling extends GpuUsableResult {
	readonly totalRamBytes: number;
	/** The raw `iogpu.wired_limit_mb` value, or null when unset/unreadable. */
	readonly wiredLimitMb: number | null;
}

/**
 * Probe the local machine's GPU-wireable ceiling. Returns null on any non-Apple-Silicon or unreadable host, which
 * the caller must treat as "leave the candidate's ceiling unset" rather than as a zero ceiling.
 */
export async function probeLocalGpuCeiling(options?: {
	readonly exec?: SysctlExec;
	readonly platform?: NodeJS.Platform;
	readonly totalRamBytes?: number;
}): Promise<LocalGpuCeiling | null> {
	const platform = options?.platform ?? process.platform;
	if (platform !== "darwin") {
		return null;
	}
	const exec = options?.exec ?? (execFileAsync as SysctlExec);
	const arm64 = await readSysctl("hw.optional.arm64", exec);
	if (arm64 !== "1") {
		// An Intel Mac has discrete/integrated VRAM semantics this ceiling does not describe.
		return null;
	}
	const totalRamBytes = options?.totalRamBytes ?? totalmem();
	if (!Number.isFinite(totalRamBytes) || totalRamBytes <= 0) {
		return null;
	}
	const rawLimit = await readSysctl("iogpu.wired_limit_mb", exec);
	const parsed = rawLimit === null ? Number.NaN : Number.parseInt(rawLimit, 10);
	// macOS reports 0 for "use the default"; the core already treats 0 as unset, but normalize to null here so the
	// returned record does not imply an explicit zero was configured.
	const wiredLimitMb = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

	return {
		...gpuUsableBytes({ totalRamBytes, wiredLimitMb, appleSilicon: true }),
		totalRamBytes,
		wiredLimitMb,
	};
}
