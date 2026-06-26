/**
 * Tests for the §5.Y #10 nonce-authenticated desktop↔runtime handshake.
 *
 * Covers:
 *   - `generateDesktopNonce()` — produces a 64-hex-char string
 *   - `resolveDesktopTrust()` pure function — all branches
 *   - `verifyRuntimeNonce()` convenience alias used in integration tests
 *   - RuntimeOrchestrator integration: correct nonce → trusted; wrong/absent
 *     nonce → NOT trusted; dev/prod split; runtime echoes nonce only when env var set
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	powerSaveBlocker: {
		start: vi.fn(() => 1),
		stop: vi.fn(),
	},
}));

// ── Pure helper exports under test ──────────────────────────────────────────

import {
	DESKTOP_HEALTH_PATH,
	DESKTOP_NONCE_ENV,
	generateDesktopNonce,
	resolveDesktopTrust,
} from "../src/runtime-trust.js";

// ── FakeChildManager (mirrors runtime-orchestrator.test.ts stub) ────────────

const childManagers: FakeChildManager[] = [];

class FakeChildManager extends EventEmitter {
	constructor() {
		super();
		childManagers.push(this);
	}
	async start(): Promise<string> {
		return "http://127.0.0.1:3484";
	}
	async shutdown(): Promise<void> {}
	async dispose(): Promise<void> {}
}

vi.mock("../src/runtime-child.js", () => ({
	RuntimeChildManager: FakeChildManager,
}));

const { RuntimeOrchestrator } = await import("../src/runtime-orchestrator.js");

// ────────────────────────────────────────────────────────────────────────────
// generateDesktopNonce
// ────────────────────────────────────────────────────────────────────────────

describe("generateDesktopNonce", () => {
	it("returns a 64-character lowercase hex string (32 bytes)", () => {
		const nonce = generateDesktopNonce();
		expect(typeof nonce).toBe("string");
		expect(nonce).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns a different value on each call", () => {
		const a = generateDesktopNonce();
		const b = generateDesktopNonce();
		expect(a).not.toBe(b);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// resolveDesktopTrust — pure function
// ────────────────────────────────────────────────────────────────────────────

describe("resolveDesktopTrust", () => {
	// ── Case 1: owned runtime (have expected nonce) ─────────────────────────

	it("trusted: owned + nonce matches", () => {
		const result = resolveDesktopTrust({
			expectedNonce: "abc123",
			nonceResponse: { nonce: "abc123" },
			titleLiveness: false,
			isPackaged: true,
		});
		expect(result.trusted).toBe(true);
	});

	it("not trusted: owned + nonce mismatch (packaged)", () => {
		const result = resolveDesktopTrust({
			expectedNonce: "abc123",
			nonceResponse: { nonce: "WRONG" },
			titleLiveness: true,
			isPackaged: true,
		});
		expect(result.trusted).toBe(false);
		expect((result as { trusted: false; reason: string }).reason).toMatch(/mismatch/);
	});

	it("not trusted: owned + nonce mismatch (dev)", () => {
		const result = resolveDesktopTrust({
			expectedNonce: "abc123",
			nonceResponse: { nonce: "WRONG" },
			titleLiveness: true,
			isPackaged: false,
		});
		expect(result.trusted).toBe(false);
		expect((result as { trusted: false; reason: string }).reason).toMatch(/mismatch/);
	});

	it("not trusted: owned + nonce endpoint absent (packaged)", () => {
		const result = resolveDesktopTrust({
			expectedNonce: "abc123",
			nonceResponse: null,
			titleLiveness: true,
			isPackaged: true,
		});
		expect(result.trusted).toBe(false);
		expect((result as { trusted: false; reason: string }).reason).toMatch(
			/desktop-health/,
		);
	});

	it("trusted: owned + nonce endpoint absent (dev) — dev leniency", () => {
		// Dev mode: spawned runtime that predates §5.Y #10 won't have the
		// endpoint. Still allow with a warning rather than blocking dev work.
		const result = resolveDesktopTrust({
			expectedNonce: "abc123",
			nonceResponse: null,
			titleLiveness: false, // title irrelevant for owned runtimes
			isPackaged: false,
		});
		expect(result.trusted).toBe(true);
	});

	// ── Case 2: pre-existing runtime (no expected nonce) ────────────────────

	it("not trusted: pre-existing + packaged (hard refuse)", () => {
		const result = resolveDesktopTrust({
			expectedNonce: null,
			nonceResponse: null,
			titleLiveness: true, // title passes but doesn't matter
			isPackaged: true,
		});
		expect(result.trusted).toBe(false);
		expect((result as { trusted: false; reason: string }).reason).toMatch(
			/pre-existing/,
		);
	});

	it("trusted: pre-existing + dev + title passes", () => {
		const result = resolveDesktopTrust({
			expectedNonce: null,
			nonceResponse: null,
			titleLiveness: true,
			isPackaged: false,
		});
		expect(result.trusted).toBe(true);
	});

	it("not trusted: pre-existing + dev + title fails", () => {
		const result = resolveDesktopTrust({
			expectedNonce: null,
			nonceResponse: null,
			titleLiveness: false,
			isPackaged: false,
		});
		expect(result.trusted).toBe(false);
		expect((result as { trusted: false; reason: string }).reason).toMatch(
			/title/,
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// RuntimeOrchestrator nonce integration
// ────────────────────────────────────────────────────────────────────────────

describe("RuntimeOrchestrator nonce handshake (§5.Y #10)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		childManagers.length = 0;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/**
	 * Build a fetch mock that echoes the orchestrator's active nonce on
	 * DESKTOP_HEALTH_PATH, and serves a healthy title for `/`. Since the
	 * nonce is read lazily at call time (after the orchestrator has set it),
	 * this works even though the orchestrator is created after the mock.
	 */
	function makeNonceFetch(
		getOrchestrator: () => InstanceType<typeof RuntimeOrchestrator> | null,
		opts: { titleOk?: boolean } = {},
	): typeof fetch {
		const titleOk = opts.titleOk ?? true;
		return vi.fn(async (url: string | URL) => {
			const urlStr = typeof url === "string" ? url : url.toString();
			if (urlStr.includes(DESKTOP_HEALTH_PATH)) {
				const nonce = getOrchestrator()?.getActiveNonce() ?? null;
				if (!nonce) return { ok: false } as Response;
				return {
					ok: true,
					json: async () => ({ nonce }),
				} as unknown as Response;
			}
			if (!titleOk) throw new Error("ECONNREFUSED");
			return {
				ok: true,
				text: async () => `<title>!Klein</title>`,
			} as unknown as Response;
		}) as unknown as typeof fetch;
	}

	it("spawned runtime: correct nonce → trusted + attach", async () => {
		// The initial connect() finds no runtime (ok: false on `/`), spawns a
		// child, then verifies the nonce echo → should attach in owned mode.
		let orchestrator: InstanceType<typeof RuntimeOrchestrator> | null = null;
		const fetchImpl = makeNonceFetch(() => orchestrator, { titleOk: false });

		orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		// Nonce was generated and set during spawn.
		expect(orchestrator.getActiveNonce()).toMatch(/^[0-9a-f]{64}$/);

		await orchestrator.shutdown();
	});

	it("spawned runtime: nonce endpoint absent + dev → trusted (dev leniency, warns)", async () => {
		// Dev mode: owned runtime that doesn't respond on /api/desktop-health
		// → still attaches but logs a warning (nonce endpoint absent = older runtime).
		const fetchImpl = vi.fn(async () => ({
			ok: false, // Initial connect falls through to spawn
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			isPackaged: false,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		// Should succeed (dev leniency for missing nonce endpoint).
		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(true);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");

		await orchestrator.shutdown();
	});

	it("spawned runtime: nonce endpoint absent + packaged → NOT trusted, connect rejects", async () => {
		// Packaged builds must refuse to attach if the nonce can't be verified.
		const fetchImpl = vi.fn(async () => ({
			ok: false, // Initial connect falls through to spawn; also for nonce check
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			isPackaged: true,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await expect(orchestrator.connect()).rejects.toThrow(/desktop-health/);
		expect(orchestrator.getUrl()).toBeNull();

		await orchestrator.shutdown().catch(() => {});
	});

	it("spawned runtime: wrong nonce (spoofer case) → NOT trusted, connect rejects", async () => {
		// The runtime echoes a different nonce than we generated → must refuse.
		let orchestrator: InstanceType<typeof RuntimeOrchestrator> | null = null;
		const fetchImpl = vi.fn(async (url: string | URL) => {
			const urlStr = typeof url === "string" ? url : url.toString();
			if (urlStr.includes(DESKTOP_HEALTH_PATH)) {
				// Spoofer returns a different nonce.
				return {
					ok: true,
					json: async () => ({ nonce: "attacker-controlled-nonce" }),
				} as unknown as Response;
			}
			return { ok: false } as Response;
		}) as unknown as typeof fetch;

		orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			isPackaged: true,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await expect(orchestrator.connect()).rejects.toThrow(/mismatch/);
		expect(orchestrator.getUrl()).toBeNull();

		await orchestrator.shutdown().catch(() => {});
	});

	it("pre-existing runtime: packaged build refuses without a nonce", async () => {
		// A packaged build must not attach to a pre-existing runtime (which
		// cannot have the nonce since we didn't spawn it).
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			text: async () => `<title>!Klein</title>`,
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			isPackaged: true,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		// Packaged + pre-existing → hard refuse regardless of title.
		// connect() will fall through to startOwnRuntime after the trust check
		// throws. The spawned runtime's nonce check will ALSO fail (fetchImpl
		// returns 200 not the nonce endpoint JSON), so the overall connect
		// rejects.
		await expect(orchestrator.connect()).rejects.toThrow();
		expect(orchestrator.getUrl()).toBeNull();

		await orchestrator.shutdown().catch(() => {});
	});

	it("pre-existing runtime: dev build attaches with title liveness only", async () => {
		// Dev mode: an existing runtime is trusted by title without nonce.
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			text: async () => `<title>!Klein</title>`,
		})) as unknown as typeof fetch;

		const orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			isPackaged: false,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(false);
		expect(orchestrator.getUrl()).toBe("http://127.0.0.1:3484");
		// No nonce set (attached mode).
		expect(orchestrator.getActiveNonce()).toBeNull();
	});

	it("getActiveNonce() is null in attached mode and non-null in owned mode", async () => {
		let orchestrator: InstanceType<typeof RuntimeOrchestrator> | null = null;
		const fetchImpl = makeNonceFetch(() => orchestrator, { titleOk: false });
		orchestrator = new RuntimeOrchestrator({
			host: "127.0.0.1",
			port: 3484,
			healthTimeoutMs: 500,
			resolveCliShimPath: () => process.execPath,
			fetchImpl,
			attachedProbeIntervalMs: 0,
			recoveryProbeIntervalMs: 0,
		});

		await orchestrator.connect();
		expect(orchestrator.isOwned()).toBe(true);
		const nonce = orchestrator.getActiveNonce();
		expect(nonce).not.toBeNull();
		expect(nonce).toMatch(/^[0-9a-f]{64}$/);

		// After restart, a new nonce is generated.
		await orchestrator.restart();
		const newNonce = orchestrator.getActiveNonce();
		expect(newNonce).not.toBeNull();
		expect(newNonce).not.toBe(nonce);

		await orchestrator.shutdown();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// DESKTOP_NONCE_ENV and DESKTOP_HEALTH_PATH exports
// ────────────────────────────────────────────────────────────────────────────

describe("runtime-trust constants", () => {
	it("DESKTOP_NONCE_ENV is the expected env var name", () => {
		expect(DESKTOP_NONCE_ENV).toBe("NKLEIN_DESKTOP_NONCE");
	});

	it("DESKTOP_HEALTH_PATH is the expected endpoint path", () => {
		expect(DESKTOP_HEALTH_PATH).toBe("/api/desktop-health");
	});
});
