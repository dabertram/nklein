import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PPQ, TempoMap, samplesPerQuarter, samplesToTicks, ticksToSamples } from "../src/index.ts";

test("samplesPerQuarter is deterministic and tempo/rate scaled", () => {
	// 120 bpm => a quarter note is 0.5 s => 24000 samples at 48 kHz.
	assert.equal(samplesPerQuarter(120, 48000), 24000);
	// Half the tempo => twice the samples.
	assert.equal(samplesPerQuarter(60, 48000), 48000);
	assert.throws(() => samplesPerQuarter(0, 48000), RangeError);
	assert.throws(() => samplesPerQuarter(120, 0), RangeError);
});

test("tick <-> sample conversion round-trips at constant tempo", () => {
	// One quarter note (DEFAULT_PPQ ticks) at 120 bpm @ 48k => 24000 samples.
	assert.equal(ticksToSamples(DEFAULT_PPQ, 120, 48000), 24000);
	const samples = ticksToSamples(12345, 137, 44100);
	assert.ok(Math.abs(samplesToTicks(samples, 137, 44100) - 12345) < 1e-6);
});

test("TempoMap sums piecewise-constant segments", () => {
	// 120 bpm for the first bar (4 quarters), then 60 bpm.
	const map = new TempoMap([
		{ tick: 0, bpm: 120 },
		{ tick: 4 * DEFAULT_PPQ, bpm: 60 },
	]);
	assert.equal(map.bpmAt(0), 120);
	assert.equal(map.bpmAt(4 * DEFAULT_PPQ), 60);
	assert.equal(map.bpmAt(2 * DEFAULT_PPQ), 120);

	// First bar: 4 quarters * 24000 = 96000 samples at 48k.
	assert.equal(map.ticksToSamples(4 * DEFAULT_PPQ, 48000), 96000);
	// One more quarter at 60 bpm (48000 samples) => 96000 + 48000.
	assert.equal(map.ticksToSamples(5 * DEFAULT_PPQ, 48000), 96000 + 48000);
	assert.equal(map.ticksToSamples(0, 48000), 0);
});

test("TempoMap guarantees a tempo from tick 0", () => {
	const map = new TempoMap([{ tick: 1920, bpm: 90 }]);
	assert.equal(map.bpmAt(0), 90);
	assert.equal(map.ticksToSamples(0, 48000), 0);
});
