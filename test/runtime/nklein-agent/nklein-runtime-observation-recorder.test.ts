import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	extractObservation: vi.fn(
		(_e: unknown, _id: unknown, _at: number, _ms: number | null) => ({ obs: true }) as unknown,
	),
	recordRequest: vi.fn(() => Promise.resolve()),
	recordContextWindow: vi.fn(() => Promise.resolve()),
	isLocalProvider: vi.fn((_p: string, _e: string | null) => true),
	readSdkAgentEvent: vi.fn((_e: unknown) => null as { type: string; message?: string; error?: unknown } | null),
	isCreditLimitError: vi.fn((_m: string) => false),
	now: vi.fn(() => 5_000),
}));

vi.mock("../../../src/nklein-agent/nklein-model-registry", () => ({
	extractNKleinModelRegistryObservationFromEvent: h.extractObservation,
	getDefaultNKleinModelRegistry: () => ({
		recordRequest: h.recordRequest,
		recordContextWindow: h.recordContextWindow,
	}),
}));
vi.mock("../../../src/nklein-agent/nklein-local-only-policy", () => ({ isLocalProvider: h.isLocalProvider }));
vi.mock("../../../src/nklein-agent/nklein-sdk-event-readers", () => ({ readSdkAgentEvent: h.readSdkAgentEvent }));
vi.mock("../../../src/nklein-agent/nklein-session-state", () => ({
	isCreditLimitError: h.isCreditLimitError,
	now: h.now,
}));
vi.mock("../../../src/nklein-agent/nklein-task-session-helpers", () => ({ toErrorMessage: (e: unknown) => String(e) }));

import {
	createRuntimeObservationRecorder,
	type RuntimeObservationRecorderDeps,
} from "../../../src/nklein-agent/nklein-runtime-observation-recorder";

function deps(over: Partial<RuntimeObservationRecorderDeps> = {}): RuntimeObservationRecorderDeps {
	return {
		resolveTaskModelIdentity: () => ({ providerId: "lmstudio", modelId: "m" }),
		getEndpoint: () => "http://localhost:1234",
		resolveKnownContextWindow: () => 32_000,
		elapsedMs: () => 1_200,
		forgetTimer: vi.fn(),
		recordObservationWithModel: vi.fn(),
		isNKleinProviderForTask: () => false,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	h.extractObservation.mockReturnValue({ obs: true });
	h.isLocalProvider.mockReturnValue(true);
	h.readSdkAgentEvent.mockReturnValue(null);
	h.isCreditLimitError.mockReturnValue(false);
});

describe("recordModelRegistryObservation", () => {
	it("records the extracted observation + forgets the timer", () => {
		const d = deps();
		createRuntimeObservationRecorder(d).recordModelRegistryObservation("t1", {} as never);
		expect(h.recordRequest).toHaveBeenCalledWith({ obs: true });
		expect(d.forgetTimer).toHaveBeenCalledWith("t1");
	});

	it("does nothing when the extractor yields no observation", () => {
		h.extractObservation.mockReturnValue(null);
		const d = deps();
		createRuntimeObservationRecorder(d).recordModelRegistryObservation("t1", {} as never);
		expect(h.recordRequest).not.toHaveBeenCalled();
		expect(d.forgetTimer).not.toHaveBeenCalled();
	});
});

describe("recordLaunchContextWindow", () => {
	const win = { providerId: "lmstudio", modelId: "m", endpoint: "http://localhost:1234", contextWindow: 32_000 };

	it("records the advertised window for a local provider", () => {
		createRuntimeObservationRecorder(deps()).recordLaunchContextWindow(win);
		expect(h.recordContextWindow).toHaveBeenCalledWith(expect.objectContaining({ advertisedContextWindow: 32_000 }));
	});

	it("skips a cloud provider", () => {
		h.isLocalProvider.mockReturnValue(false);
		createRuntimeObservationRecorder(deps()).recordLaunchContextWindow(win);
		expect(h.recordContextWindow).not.toHaveBeenCalled();
	});

	it("skips a non-positive / non-finite window", () => {
		const rec = createRuntimeObservationRecorder(deps());
		rec.recordLaunchContextWindow({ ...win, contextWindow: 0 });
		rec.recordLaunchContextWindow({ ...win, contextWindow: null });
		expect(h.recordContextWindow).not.toHaveBeenCalled();
	});
});

describe("recordSdkEventObservation", () => {
	it("ignores non-error events", () => {
		h.readSdkAgentEvent.mockReturnValue({ type: "text" });
		const d = deps();
		createRuntimeObservationRecorder(d).recordSdkEventObservation("t1", {});
		expect(d.recordObservationWithModel).not.toHaveBeenCalled();
	});

	it("classifies a credit-limit error from an NKlein provider as provider_error", () => {
		h.readSdkAgentEvent.mockReturnValue({ type: "error", message: "quota exceeded" });
		h.isCreditLimitError.mockReturnValue(true);
		const d = deps({ isNKleinProviderForTask: () => true });
		createRuntimeObservationRecorder(d).recordSdkEventObservation("t1", {});
		expect(d.recordObservationWithModel).toHaveBeenCalledWith(expect.objectContaining({ signal: "provider_error" }));
	});

	it("classifies a plain error as runtime_error", () => {
		h.readSdkAgentEvent.mockReturnValue({ type: "run-failed", message: "boom" });
		const d = deps();
		createRuntimeObservationRecorder(d).recordSdkEventObservation("t1", {});
		expect(d.recordObservationWithModel).toHaveBeenCalledWith(expect.objectContaining({ signal: "runtime_error" }));
	});
});
