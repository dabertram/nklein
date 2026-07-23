import { createHash } from "node:crypto";

export interface NightlyRecordingEvidence {
	readonly setId: string;
	readonly fixture: string;
	readonly runFile: string;
	readonly sha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class NightlyRecordingBindingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NightlyRecordingBindingError";
	}
}

export function recordingSetIdForFixture(fixture: string): string {
	const normalized = fixture.trim();
	const numericPrefix = /^(\d{2})(?:_|$)/.exec(normalized)?.[1];
	return numericPrefix ? `sim-${numericPrefix}` : `sim-${normalized}`;
}

/**
 * Validate the receipt again at the process boundary that turns it into a nightly verdict.
 *
 * The drain is responsible for binding the recording to bytes, but stdout is an untyped transport. Merely finding
 * a JSON-looking line would let truncated, stale, or accidentally duplicated output become durable "evidence".
 */
export function parseNightlyRecordingEvidence(input: {
	readonly raw: string;
	readonly expectedFixture: string;
	readonly expectedRecordingSet: string;
	readonly expectedRunFile: string;
}): NightlyRecordingEvidence {
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.raw);
	} catch (error) {
		throw new NightlyRecordingBindingError(
			`nightly recording evidence is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed)) {
		throw new NightlyRecordingBindingError("nightly recording evidence must be a JSON object");
	}
	const { setId, fixture, runFile, sha256 } = parsed;
	if (fixture !== input.expectedFixture) {
		throw new NightlyRecordingBindingError(
			`nightly evidence fixture mismatch: expected "${input.expectedFixture}", received "${String(fixture)}"`,
		);
	}
	if (setId !== input.expectedRecordingSet) {
		throw new NightlyRecordingBindingError(
			`nightly evidence recording-set mismatch: expected "${input.expectedRecordingSet}", received "${String(setId)}"`,
		);
	}
	if (runFile !== input.expectedRunFile) {
		throw new NightlyRecordingBindingError(
			`nightly evidence run-file mismatch: expected "${input.expectedRunFile}", received "${String(runFile)}"`,
		);
	}
	if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
		throw new NightlyRecordingBindingError(
			"nightly evidence sha256 must be exactly 64 lowercase hexadecimal characters",
		);
	}
	return { setId, fixture, runFile, sha256 };
}

/**
 * Bind one manifest claim to the exact scenario bytes the drain will serve.
 *
 * `fixture` and `recordingSet` were originally copied through the nightly manifest but never consumed. A green
 * verdict could therefore name evidence different from what ran. Validation belongs immediately after resolution,
 * before the simulator starts, and the digest makes the successful claim replayable after a recording changes.
 */
export function bindNightlyRecording(input: {
	readonly selector: string;
	readonly resolvedFixture: string;
	readonly expectedFixture?: string | null;
	readonly expectedRecordingSet?: string | null;
	readonly runFile: string;
	readonly rawScenario: string;
}): NightlyRecordingEvidence {
	const expectedFixture = input.expectedFixture?.trim() ?? "";
	const expectedRecordingSet = input.expectedRecordingSet?.trim() ?? "";
	if (expectedFixture && input.resolvedFixture !== expectedFixture) {
		throw new NightlyRecordingBindingError(
			`nightly fixture mismatch: manifest declared "${expectedFixture}", selector "${input.selector}" resolved "${input.resolvedFixture}"`,
		);
	}
	const setId = recordingSetIdForFixture(input.resolvedFixture);
	if (expectedRecordingSet && setId !== expectedRecordingSet) {
		throw new NightlyRecordingBindingError(
			`nightly recording-set mismatch: manifest declared "${expectedRecordingSet}", resolved fixture "${input.resolvedFixture}" owns "${setId}"`,
		);
	}
	return {
		setId,
		fixture: input.resolvedFixture,
		runFile: input.runFile,
		sha256: createHash("sha256").update(input.rawScenario).digest("hex"),
	};
}
