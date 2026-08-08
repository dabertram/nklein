import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * The Node-side error reporter, and the only thing here that really matters is the DEFAULT: no DSN is
 * hardcoded, the value comes from the environment, and with none set nothing is initialised and nothing leaves
 * the machine. In a local-only product that default IS the feature.
 *
 * It is also the kind of default that can be lost without any visible symptom. A hardcoded fallback DSN, or an
 * `initialized` that starts true, would silently begin shipping errors off the machine — and every test that
 * merely calls `captureNodeException` and checks it does not throw would stay green throughout. So the probes
 * below assert on the Sentry SDK spies: what must be true is that `init` was never called and `captureException`
 * never reached.
 *
 * The DSN is read at MODULE LOAD, so each case resets the module registry and re-imports under a fresh
 * environment rather than trying to mutate a decision already made.
 */
const sentry = vi.hoisted(() => ({
	init: vi.fn(),
	captureException: vi.fn(),
	flush: vi.fn(async () => true),
	withScope: vi.fn((callback: (scope: { setTag: ReturnType<typeof vi.fn> }) => void) => {
		callback({ setTag: vi.fn() });
	}),
}));

vi.mock("@sentry/node", () => sentry);

const ENV_KEYS = ["NKLEIN_SENTRY_DSN", "SENTRY_DSN", "SENTRY_NODE_ENVIRONMENT", "NODE_ENV"] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

async function loadWith(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
	Object.assign(process.env, env);
	vi.resetModules();
	vi.clearAllMocks();
	return await import("../../../src/telemetry/sentry-node");
}

beforeEach(() => {
	saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = saved[key];
		}
	}
	vi.resetModules();
});

describe("the default is silence", () => {
	it("does not initialise Sentry when no DSN is configured", async () => {
		// THE probe. Asserted on the spy, because a module that had quietly acquired a hardcoded DSN would still
		// return cleanly from every call below.
		const module = await loadWith({});

		expect(sentry.init).not.toHaveBeenCalled();
		expect(module.isNodeSentryEnabled()).toBe(false);
	});

	it("sends nothing when capture is called with no DSN configured", async () => {
		const module = await loadWith({});
		module.captureNodeException(new Error("boom"), { area: "test" });

		expect(sentry.captureException).not.toHaveBeenCalled();
		expect(sentry.withScope).not.toHaveBeenCalled();
	});

	it("flushes nothing, and does not hang, with no DSN configured", async () => {
		// Shutdown paths call flush unconditionally; reaching the SDK here would block a teardown on a network
		// round trip that has no destination.
		const module = await loadWith({});

		await expect(module.flushNodeTelemetry()).resolves.toBeUndefined();
		expect(sentry.flush).not.toHaveBeenCalled();
	});

	it("treats a whitespace-only DSN as unset", async () => {
		// The shape a half-filled env file actually produces. A truthiness check alone would init the SDK with a
		// blank destination and report itself as enabled.
		const module = await loadWith({ NKLEIN_SENTRY_DSN: "   " });

		expect(sentry.init).not.toHaveBeenCalled();
		expect(module.isNodeSentryEnabled()).toBe(false);
	});
});

describe("when an operator configures a DSN", () => {
	it("initialises with that DSN and reports itself enabled", async () => {
		const module = await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });

		expect(sentry.init).toHaveBeenCalledTimes(1);
		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ dsn: "https://key@example.invalid/1" });
		expect(module.isNodeSentryEnabled()).toBe(true);
	});

	it("never sends default PII", async () => {
		// Pinned explicitly rather than trusted: flipping this one flag starts attaching user and request data to
		// every event, and nothing in the module's behaviour would look different from here.
		await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });

		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ sendDefaultPii: false });
	});

	it("prefers the NKLEIN-scoped DSN over a generic SENTRY_DSN", async () => {
		// A generic `SENTRY_DSN` may already exist in a developer's shell for something else entirely; the scoped
		// name is what says "this product, deliberately".
		await loadWith({ NKLEIN_SENTRY_DSN: "https://ours@example.invalid/1", SENTRY_DSN: "https://theirs@x.invalid/2" });

		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ dsn: "https://ours@example.invalid/1" });
	});

	it("falls back to SENTRY_DSN when the scoped one is absent", async () => {
		await loadWith({ SENTRY_DSN: "https://theirs@example.invalid/2" });

		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ dsn: "https://theirs@example.invalid/2" });
	});

	it("defaults the environment to development, not production", async () => {
		// The safer default when nothing says otherwise: events mislabelled production pollute the signal an
		// operator would actually act on.
		await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });

		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ environment: "development" });
	});

	it("prefers SENTRY_NODE_ENVIRONMENT over NODE_ENV", async () => {
		await loadWith({
			NKLEIN_SENTRY_DSN: "https://key@example.invalid/1",
			SENTRY_NODE_ENVIRONMENT: "staging",
			NODE_ENV: "production",
		});

		expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({ environment: "staging" });
	});

	it("tags the surface so node events are separable from the web ones", async () => {
		await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });

		expect(sentry.init.mock.calls[0]?.[0]?.initialScope?.tags).toMatchObject({ runtime_surface: "node" });
	});

	it("captures an exception, tagging the area it came from", async () => {
		const module = await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });
		const setTag = vi.fn();
		sentry.withScope.mockImplementation((callback) => {
			callback({ setTag });
		});
		const error = new Error("boom");
		module.captureNodeException(error, { area: "swarm" });

		expect(setTag).toHaveBeenCalledWith("error_area", "swarm");
		expect(sentry.captureException).toHaveBeenCalledWith(error);
	});

	it("captures without an area rather than inventing one", async () => {
		const module = await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });
		const setTag = vi.fn();
		sentry.withScope.mockImplementation((callback) => {
			callback({ setTag });
		});
		module.captureNodeException(new Error("boom"));

		expect(setTag).not.toHaveBeenCalled();
		expect(sentry.captureException).toHaveBeenCalledTimes(1);
	});

	it("flushes with the caller's timeout, and a bounded default", async () => {
		// Flush runs on shutdown, so an unbounded wait turns a clean exit into a hang.
		const module = await loadWith({ NKLEIN_SENTRY_DSN: "https://key@example.invalid/1" });
		await module.flushNodeTelemetry(50);
		expect(sentry.flush).toHaveBeenCalledWith(50);

		await module.flushNodeTelemetry();
		expect(sentry.flush).toHaveBeenLastCalledWith(2_000);
	});
});
