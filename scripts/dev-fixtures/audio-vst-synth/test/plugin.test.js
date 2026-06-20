import assert from "node:assert/strict";
import test from "node:test";
import { peakLevel, renderBass, renderKick } from "../src/index.ts";

test("renders bounded kick and bass buffers", () => {
	const kick = renderKick({
		sampleRate: 44100,
		durationSeconds: 0.2,
		fundamentalHz: 50,
		clickLevel: 0.15,
		decay: 18,
	});
	const bass = renderBass({
		sampleRate: 44100,
		durationSeconds: 0.125,
		noteHz: 55,
		drive: 1.4,
	});

	assert.equal(kick.sampleRate, 44100);
	assert.equal(bass.sampleRate, 44100);
	assert.ok(kick.samples.length > bass.samples.length);
	assert.ok(peakLevel(kick) <= 1);
	assert.ok(peakLevel(bass) <= 1);
});
