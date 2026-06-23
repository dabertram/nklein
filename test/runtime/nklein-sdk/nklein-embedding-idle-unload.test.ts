import { describe, expect, it, vi } from "vitest";
import { createLocalGgufEmbeddingProvider } from "../../../src/nklein-sdk/nklein-code-embeddings";
import {
	type EmbeddingIdleUnloadEvent,
	EmbeddingIdleUnloadScheduler,
} from "../../../src/nklein-sdk/nklein-embedding-idle-unload";
import type {
	EmbeddingModelManifest,
	EnsureEmbeddingModelResult,
} from "../../../src/nklein-sdk/nklein-embedding-model-manager";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Scheduler harness that captures the armed callback so the timer can be fired deterministically. */
function makeHarness(options?: { fetchImpl?: typeof fetch; onUnload?: (event: EmbeddingIdleUnloadEvent) => void }) {
	let captured: (() => void) | null = null;
	let armedMs: number | null = null;
	const clears: number[] = [];
	let nextHandle = 0;
	const setTimeoutImpl = (callback: () => void, ms: number): ReturnType<typeof setTimeout> => {
		captured = callback;
		armedMs = ms;
		nextHandle += 1;
		return nextHandle as unknown as ReturnType<typeof setTimeout>;
	};
	const clearTimeoutImpl = (handle: ReturnType<typeof setTimeout>) => {
		clears.push(handle as unknown as number);
	};
	const scheduler = new EmbeddingIdleUnloadScheduler({
		idleMs: 1234,
		fetchImpl: options?.fetchImpl,
		setTimeoutImpl,
		clearTimeoutImpl,
		onUnload: options?.onUnload,
	});
	return {
		scheduler,
		fire: () => captured?.(),
		get armedMs() {
			return armedMs;
		},
		get clearCount() {
			return clears.length;
		},
	};
}

const okEmbedResponse = (async () =>
	new Response(JSON.stringify({ embeddings: [[1, 0, 0.5]], backend: "llama_cpp" }), {
		status: 200,
	})) as unknown as typeof fetch;

describe("EmbeddingIdleUnloadScheduler", () => {
	it("arms a timer on touch and frees the model via /v1/embed/unload when it fires", async () => {
		let unloadRequest: { url: string; body: unknown } | null = null;
		const events: EmbeddingIdleUnloadEvent[] = [];
		const fetchImpl = (async (url: string, init?: { body?: string }) => {
			unloadRequest = { url, body: init?.body ? JSON.parse(init.body) : null };
			return new Response(JSON.stringify({ unloaded: 1 }), { status: 200 });
		}) as unknown as typeof fetch;
		const harness = makeHarness({ fetchImpl, onUnload: (event) => events.push(event) });

		harness.scheduler.touch({ sidecarUrl: "http://127.0.0.1:3585", ggufPath: "/models/embed.gguf" });
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://127.0.0.1:3585", ggufPath: "/models/embed.gguf" })).toBe(
			true,
		);
		expect(harness.armedMs).toBe(1234);

		harness.fire();
		await flush();

		expect(unloadRequest).toEqual({
			url: "http://127.0.0.1:3585/v1/embed/unload",
			body: { gguf_path: "/models/embed.gguf" },
		});
		expect(events).toEqual([
			{ sidecarUrl: "http://127.0.0.1:3585", ggufPath: "/models/embed.gguf", unloaded: 1, ok: true },
		]);
		// The timer is consumed when it fires.
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://127.0.0.1:3585", ggufPath: "/models/embed.gguf" })).toBe(
			false,
		);
	});

	it("re-arming clears the previous timer (active bursts never unload)", () => {
		const harness = makeHarness();
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/m.gguf" });
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/m.gguf" });
		expect(harness.clearCount).toBe(1);
	});

	it("honours a per-touch idle override", () => {
		const harness = makeHarness();
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/m.gguf", idleMs: 50 });
		expect(harness.armedMs).toBe(50);
	});

	it("normalizes trailing slashes so the same model shares one timer", () => {
		const harness = makeHarness();
		harness.scheduler.touch({ sidecarUrl: "http://x:3585/", ggufPath: "/m.gguf" });
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://x:3585", ggufPath: "/m.gguf" })).toBe(true);
	});

	it("cancel removes a pending unload without firing it", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
		const harness = makeHarness({ fetchImpl });
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/m.gguf" });
		harness.scheduler.cancel({ sidecarUrl: "http://x", ggufPath: "/m.gguf" });
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://x", ggufPath: "/m.gguf" })).toBe(false);
		expect(harness.clearCount).toBe(1);
		await flush();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("unloadNow returns null and reports failure on a non-ok response", async () => {
		const events: EmbeddingIdleUnloadEvent[] = [];
		const scheduler = new EmbeddingIdleUnloadScheduler({
			fetchImpl: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch,
			onUnload: (event) => events.push(event),
		});
		const result = await scheduler.unloadNow({ sidecarUrl: "http://x", ggufPath: "/m.gguf" });
		expect(result).toBeNull();
		expect(events[0]).toMatchObject({ unloaded: null, ok: false });
	});

	it("unloadNow tolerates a thrown fetch (core unreachable)", async () => {
		const scheduler = new EmbeddingIdleUnloadScheduler({
			fetchImpl: (async () => {
				throw new Error("ECONNREFUSED");
			}) as unknown as typeof fetch,
		});
		await expect(scheduler.unloadNow({ sidecarUrl: "http://x", ggufPath: "/m.gguf" })).resolves.toBeNull();
	});

	it("dispose clears every pending timer without firing", () => {
		const harness = makeHarness();
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/a.gguf" });
		harness.scheduler.touch({ sidecarUrl: "http://x", ggufPath: "/b.gguf" });
		harness.scheduler.dispose();
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://x", ggufPath: "/a.gguf" })).toBe(false);
		expect(harness.scheduler.isArmed({ sidecarUrl: "http://x", ggufPath: "/b.gguf" })).toBe(false);
	});
});

const MANIFEST: EmbeddingModelManifest = {
	id: "test-embed",
	version: "1",
	label: "Test Embed",
	fileName: "test-embed.gguf",
	url: "https://example.invalid/test-embed.gguf",
	dimension: 4,
};
const ensureOk = async (): Promise<EnsureEmbeddingModelResult> => ({
	installed: true,
	modelPath: "/models/test-embed.gguf",
	downloaded: false,
	alreadyCurrent: true,
	sizeBytes: 100,
});

describe("local_gguf provider idle-unload wiring", () => {
	const arming = { sidecarUrl: "http://127.0.0.1:3585", ggufPath: "/models/test-embed.gguf" };

	it("arms the idle-unload timer after a successful embed", async () => {
		const harness = makeHarness();
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://127.0.0.1:3585",
			manifest: MANIFEST,
			fetchImpl: okEmbedResponse,
			ensureModel: ensureOk,
			idleUnloadScheduler: harness.scheduler,
		});
		await provider.embed("hello world");
		expect(harness.scheduler.isArmed(arming)).toBe(true);
	});

	it("still arms when the embed degrades to lexical (model may be resident after a load+error)", async () => {
		const harness = makeHarness();
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://127.0.0.1:3585",
			manifest: MANIFEST,
			fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
			ensureModel: ensureOk,
			idleUnloadScheduler: harness.scheduler,
		});
		await provider.embed("hello world");
		expect(harness.scheduler.isArmed(arming)).toBe(true);
	});

	it("does NOT arm when the model never provisioned (nothing is loaded to free)", async () => {
		const harness = makeHarness();
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://127.0.0.1:3585",
			manifest: MANIFEST,
			fetchImpl: okEmbedResponse,
			ensureModel: async () => {
				throw new Error("download failed");
			},
			idleUnloadScheduler: harness.scheduler,
		});
		await provider.embed("hello world");
		expect(harness.scheduler.isArmed(arming)).toBe(false);
	});

	it("idleUnloadMs <= 0 disables idle unloading", async () => {
		const harness = makeHarness();
		const provider = createLocalGgufEmbeddingProvider({
			sidecarUrl: "http://127.0.0.1:3585",
			manifest: MANIFEST,
			fetchImpl: okEmbedResponse,
			ensureModel: ensureOk,
			idleUnloadScheduler: harness.scheduler,
			idleUnloadMs: 0,
		});
		await provider.embed("hello world");
		expect(harness.scheduler.isArmed(arming)).toBe(false);
	});
});
