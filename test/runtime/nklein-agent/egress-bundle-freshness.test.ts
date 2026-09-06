import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	computeEgressBundleSourceHash,
	EGRESS_BUNDLE_STAMP_FILENAME,
	EGRESS_BUNDLE_STAMP_VERSION,
} from "../../../src/core/egress-bundle-stamp";
import {
	EGRESS_PROXY_AUTOREBUILD_ENV,
	egressBundleRootDir,
	ensureEgressBundleFresh,
} from "../../../src/nklein-agent/egress-bundle-freshness";

let root: string;
let bundlePath: string;
const inputs = ["src/nklein-agent/egress-proxy-entrypoint.ts", "src/core/egress-task-identity.ts"];

function writeSources(contents: Record<string, string>): void {
	for (const [relativePath, content] of Object.entries(contents)) {
		mkdirSync(join(root, relativePath, ".."), { recursive: true });
		writeFileSync(join(root, relativePath), content);
	}
}

function writeStamp(contents: Record<string, string>): void {
	const stamp = {
		version: EGRESS_BUNDLE_STAMP_VERSION,
		builtAt: "2026-09-06T11:16:00.000Z",
		inputs: Object.keys(contents),
		sourceHash: computeEgressBundleSourceHash(Object.entries(contents).map(([path, content]) => ({ path, content }))),
	};
	writeFileSync(join(root, "dist", "egress-proxy", EGRESS_BUNDLE_STAMP_FILENAME), JSON.stringify(stamp));
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "nklein-egress-bundle-"));
	mkdirSync(join(root, "dist", "egress-proxy"), { recursive: true });
	mkdirSync(join(root, "scripts"), { recursive: true });
	bundlePath = join(root, "dist", "egress-proxy", "entrypoint.mjs");
	writeFileSync(bundlePath, "// bundle\n");
	writeFileSync(join(root, "scripts", "build-egress-proxy.mjs"), "// build script\n");
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("ensureEgressBundleFresh (2026-09-06 stale proxy bundle)", () => {
	it("derives the repo root from the bundle path", () => {
		expect(egressBundleRootDir("/repo/dist/egress-proxy/entrypoint.mjs")).toBe("/repo");
	});

	it("leaves a fresh bundle alone", async () => {
		const sources = { [inputs[0] as string]: "a", [inputs[1] as string]: "b" };
		writeSources(sources);
		writeStamp(sources);
		const runRebuild = vi.fn();
		const outcome = await ensureEgressBundleFresh(bundlePath, { runRebuild, env: {} });
		expect(outcome.freshness.status).toBe("fresh");
		expect(outcome.rebuilt).toBe(false);
		expect(runRebuild).not.toHaveBeenCalled();
	});

	it("rebuilds a stale bundle in place, re-assesses, and records the rebuild", async () => {
		const stamped = { [inputs[0] as string]: "a", [inputs[1] as string]: "b" };
		const current = { [inputs[0] as string]: "a", [inputs[1] as string]: "b-changed" };
		writeSources(current);
		writeStamp(stamped);
		const warn = vi.fn();
		const observe = vi.fn();
		const runRebuild = vi.fn(async (scriptPath: string, cwd: string) => {
			expect(scriptPath).toBe(join(root, "scripts", "build-egress-proxy.mjs"));
			expect(cwd).toBe(root);
			writeStamp(current); // what the real script does
			return { ok: true, error: null };
		});
		const outcome = await ensureEgressBundleFresh(bundlePath, { runRebuild, env: {}, warn, observe });
		expect(outcome.rebuilt).toBe(true);
		expect(outcome.freshness.status).toBe("fresh");
		expect(runRebuild).toHaveBeenCalledTimes(1);
		expect(observe).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ category: "egress_bundle_rebuilt" }) }),
		);
		expect(warn.mock.calls[0]?.[0]).toContain("Rebuilt the egress proxy bundle");
	});

	it("treats an unstamped bundle as stale when a build script exists (the pre-stamp bundle of 2026-07-21)", async () => {
		writeSources({ [inputs[0] as string]: "a" });
		const runRebuild = vi.fn(async () => {
			writeStamp({ [inputs[0] as string]: "a" });
			return { ok: true, error: null };
		});
		const outcome = await ensureEgressBundleFresh(bundlePath, { runRebuild, env: {} });
		expect(outcome.rebuilt).toBe(true);
		expect(outcome.freshness.status).toBe("fresh");
	});

	it("only warns when auto-rebuild is disabled, and records the failure when the rebuild breaks", async () => {
		const stamped = { [inputs[0] as string]: "a" };
		writeSources({ [inputs[0] as string]: "changed" });
		writeStamp(stamped);
		const observe = vi.fn();
		const runRebuild = vi.fn();
		const disabled = await ensureEgressBundleFresh(bundlePath, {
			runRebuild,
			env: { [EGRESS_PROXY_AUTOREBUILD_ENV]: "0" },
			observe,
		});
		expect(disabled.rebuilt).toBe(false);
		expect(runRebuild).not.toHaveBeenCalled();
		expect(observe).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ category: "egress_bundle_stale" }) }),
		);

		observe.mockClear();
		const broken = await ensureEgressBundleFresh(bundlePath, {
			runRebuild: async () => ({ ok: false, error: "esbuild exploded" }),
			env: {},
			observe,
		});
		expect(broken.rebuilt).toBe(false);
		expect(broken.freshness.status).toBe("stale");
		expect(observe.mock.calls[0]?.[0]).toMatchObject({
			metadata: { category: "egress_bundle_stale", rebuilt: false, error: "esbuild exploded" },
		});
	});

	it("skips a packaged app quietly — stamped inputs the tree does not have, or no build script at all", async () => {
		writeStamp({ [inputs[0] as string]: "a" }); // no src/ files written
		const observe = vi.fn();
		const runRebuild = vi.fn();
		const unverifiable = await ensureEgressBundleFresh(bundlePath, { runRebuild, env: {}, observe });
		expect(unverifiable.freshness.status).toBe("unverifiable");
		expect(runRebuild).not.toHaveBeenCalled();
		expect(observe).not.toHaveBeenCalled();

		rmSync(join(root, "scripts", "build-egress-proxy.mjs"));
		rmSync(join(root, "dist", "egress-proxy", EGRESS_BUNDLE_STAMP_FILENAME));
		const unstampedPackaged = await ensureEgressBundleFresh(bundlePath, { runRebuild, env: {}, observe });
		expect(unstampedPackaged.freshness.status).toBe("unstamped");
		expect(observe).not.toHaveBeenCalled();
	});
});
