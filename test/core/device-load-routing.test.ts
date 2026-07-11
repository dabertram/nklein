import { describe, expect, it } from "vitest";
import {
	type DeviceLoadCandidate,
	resolveDeviceRamBytesFromEnv,
	selectDeviceForModelLoad,
} from "../../src/core/device-load-routing";

const GiB = 1024 ** 3;
const gb = (n: number): number => n * GiB;

// The live fleet shape (2026-07-11): a 128 GB farm, an undersized mini, a mid GPU box.
const m5max = (residentGb = 0): DeviceLoadCandidate => ({
	deviceName: "Local",
	deviceIdentifier: "id-m5max",
	totalRamBytes: gb(128),
	residentSizeBytes: gb(residentGb),
});
const m4mini = (residentGb = 0): DeviceLoadCandidate => ({
	deviceName: "m4mini",
	deviceIdentifier: "id-m4mini",
	totalRamBytes: gb(16),
	residentSizeBytes: gb(residentGb),
});
const legion = (residentGb = 0): DeviceLoadCandidate => ({
	deviceName: "legion5pro",
	deviceIdentifier: "id-legion",
	totalRamBytes: gb(24),
	residentSizeBytes: gb(residentGb),
});

describe("selectDeviceForModelLoad", () => {
	it("keeps a 14B (@40k ctx, ~13 GB effective) OFF the undersized m4mini and picks the farm (the real crash case)", () => {
		const decision = selectDeviceForModelLoad({
			candidateSizeBytes: gb(13),
			candidates: [m4mini(), m5max(), legion()],
		});
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("Local");
			expect(decision.deviceIdentifier).toBe("id-m5max");
			// m4mini can't hold 13 GB within its 25% reserve → rejected with a reason.
			expect(decision.rejected.map((r) => r.deviceName)).toContain("m4mini");
			const mini = decision.rejected.find((r) => r.deviceName === "m4mini");
			expect(mini?.reason).toMatch(/reserve|freeze|free/i);
			// legion fits too but has less headroom → an alternative, not the pick.
			expect(decision.alternatives.map((a) => a.deviceName)).toEqual(["legion5pro"]);
		}
	});

	it("picks the device with the MOST free headroom among fitting devices", () => {
		const decision = selectDeviceForModelLoad({
			candidateSizeBytes: gb(4),
			candidates: [legion(), m5max()], // both fit a 4 GB model; m5max has far more headroom
		});
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("Local");
			expect(decision.alternatives.map((a) => a.deviceName)).toEqual(["legion5pro"]);
		}
	});

	it("accounts for the resident set on each device (a busy farm can be beaten by an idle box)", () => {
		// m5max already 120/128 GB resident ⇒ only ~8 GB free; legion idle ⇒ ~24 GB free. A 6 GB model:
		// m5max free-after = 128-120-6 = 2 GB < 32 GB reserve ⇒ REJECTED; legion free-after = 18 GB > 6 GB reserve ⇒ fits.
		const decision = selectDeviceForModelLoad({
			candidateSizeBytes: gb(6),
			candidates: [m5max(120), legion(0)],
		});
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("legion5pro");
			expect(decision.rejected.map((r) => r.deviceName)).toContain("Local");
		}
	});

	it("refuses (fits:false) when NO device can hold the model without overloading", () => {
		const decision = selectDeviceForModelLoad({
			candidateSizeBytes: gb(20), // exceeds m4mini's whole RAM and legion's usable headroom
			candidates: [m4mini(), legion()],
		});
		expect(decision.fits).toBe(false);
		if (!decision.fits) {
			expect(decision.reason).toMatch(/No linked device/i);
			expect(decision.rejected.map((r) => r.deviceName).sort()).toEqual(["legion5pro", "m4mini"]);
		}
	});

	it("refuses on an empty candidate list", () => {
		const decision = selectDeviceForModelLoad({ candidateSizeBytes: gb(4), candidates: [] });
		expect(decision.fits).toBe(false);
		if (!decision.fits) {
			expect(decision.reason).toMatch(/no candidate devices/i);
			expect(decision.rejected).toEqual([]);
		}
	});

	it("refuses when the candidate size is non-positive (cannot prove headroom)", () => {
		const decision = selectDeviceForModelLoad({ candidateSizeBytes: 0, candidates: [m5max()] });
		expect(decision.fits).toBe(false);
	});

	it("breaks ties by declaration order (stable) when free headroom is equal", () => {
		// Two identical 32 GB idle boxes, a 4 GB model — equal headroom; the first declared wins.
		const boxA: DeviceLoadCandidate = {
			deviceName: "boxA",
			totalRamBytes: gb(32),
			residentSizeBytes: 0,
		};
		const boxB: DeviceLoadCandidate = { ...boxA, deviceName: "boxB" };
		const decision = selectDeviceForModelLoad({ candidateSizeBytes: gb(4), candidates: [boxA, boxB] });
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("boxA");
			expect(decision.alternatives.map((a) => a.deviceName)).toEqual(["boxB"]);
		}
	});

	it("omits deviceIdentifier from the decision when the chosen candidate has none", () => {
		const bare: DeviceLoadCandidate = { deviceName: "bare", totalRamBytes: gb(64), residentSizeBytes: 0 };
		const decision = selectDeviceForModelLoad({ candidateSizeBytes: gb(4), candidates: [bare] });
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("bare");
			expect("deviceIdentifier" in decision).toBe(false);
		}
	});

	it("honors a tighter reserveFraction (a stricter buffer rejects a marginal fit)", () => {
		// legion 24 GB, 16 GB model: default 25% reserve (6 GB) ⇒ free-after 8 GB ≥ 6 ⇒ fits;
		// but a 0.5 reserve (12 GB) ⇒ free-after 8 GB < 12 ⇒ rejected.
		const lenient = selectDeviceForModelLoad({ candidateSizeBytes: gb(16), candidates: [legion()] });
		expect(lenient.fits).toBe(true);
		const strict = selectDeviceForModelLoad({
			candidateSizeBytes: gb(16),
			candidates: [legion()],
			reserveFraction: 0.5,
		});
		expect(strict.fits).toBe(false);
	});

	it("forwards a user RAM budget cap (plans against the smaller of RAM and the cap)", () => {
		// m5max 128 GB physical but the user caps !Klein at 10 GB ⇒ a 9 GB model no longer fits (below the reserve).
		const uncapped = selectDeviceForModelLoad({ candidateSizeBytes: gb(9), candidates: [m5max()] });
		expect(uncapped.fits).toBe(true);
		const capped = selectDeviceForModelLoad({
			candidateSizeBytes: gb(9),
			candidates: [m5max()],
			userBudgetBytes: gb(10),
		});
		expect(capped.fits).toBe(false);
	});
});

describe("resolveDeviceRamBytesFromEnv", () => {
	it("parses a comma-separated name:GB map into per-device bytes", () => {
		const map = resolveDeviceRamBytesFromEnv({ NKLEIN_DEVICE_RAM_GB: "Local:128,m4mini:16,legion5pro:24" });
		expect(map).toEqual({ Local: gb(128), m4mini: gb(16), legion5pro: gb(24) });
	});

	it("returns an empty map when unset or blank (⇒ the selector disengages, byte-identical)", () => {
		expect(resolveDeviceRamBytesFromEnv({})).toEqual({});
		expect(resolveDeviceRamBytesFromEnv({ NKLEIN_DEVICE_RAM_GB: "   " })).toEqual({});
	});

	it("is whitespace-tolerant around names, numbers, and separators", () => {
		const map = resolveDeviceRamBytesFromEnv({ NKLEIN_DEVICE_RAM_GB: "  Local : 128 , m4mini : 16 " });
		expect(map).toEqual({ Local: gb(128), m4mini: gb(16) });
	});

	it("skips malformed / non-positive / non-numeric entries (fail-open, never a false RAM figure)", () => {
		const map = resolveDeviceRamBytesFromEnv({
			NKLEIN_DEVICE_RAM_GB: "Local:128,bogus,m4mini:,legion:0,neg:-4,ok:32,:64",
		});
		// Only the two well-formed positive entries survive.
		expect(map).toEqual({ Local: gb(128), ok: gb(32) });
	});

	it("accepts fractional GB and rounds to whole bytes", () => {
		const map = resolveDeviceRamBytesFromEnv({ NKLEIN_DEVICE_RAM_GB: "mini:16.5" });
		expect(map).toEqual({ mini: Math.round(16.5 * GiB) });
	});

	it("feeds selectDeviceForModelLoad end-to-end (env map → candidate RAM → keeps 14B off m4mini)", () => {
		const ram = resolveDeviceRamBytesFromEnv({ NKLEIN_DEVICE_RAM_GB: "Local:128,m4mini:16" });
		const candidates: DeviceLoadCandidate[] = [
			{ deviceName: "m4mini", totalRamBytes: ram.m4mini, residentSizeBytes: 0 },
			{ deviceName: "Local", totalRamBytes: ram.Local, residentSizeBytes: 0 },
		];
		const decision = selectDeviceForModelLoad({ candidateSizeBytes: gb(13), candidates });
		expect(decision.fits).toBe(true);
		if (decision.fits) {
			expect(decision.deviceName).toBe("Local");
		}
	});
});
