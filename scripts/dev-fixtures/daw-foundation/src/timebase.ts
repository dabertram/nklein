// Musical timebase — the bedrock conversion layer between musical time (PPQ ticks) and audio time
// (samples), tempo-map aware. See specification.md §16.2 "Time Representation" and §7 "Audio Engine".
// This is a small, real, deterministic seed: grow it into the full arrangement/automation/warp engines.

/** Pulses (ticks) per quarter note. 960 is a common high-resolution default. */
export const DEFAULT_PPQ = 960;

export interface TempoPoint {
	/** Musical position in ticks where this tempo takes effect. */
	tick: number;
	/** Beats per minute (quarter notes per minute) from this tick onward. */
	bpm: number;
}

/** Samples occupied by one quarter note at a given tempo and sample rate. */
export function samplesPerQuarter(bpm: number, sampleRate: number): number {
	if (bpm <= 0) {
		throw new RangeError(`bpm must be positive, got ${bpm}`);
	}
	if (sampleRate <= 0) {
		throw new RangeError(`sampleRate must be positive, got ${sampleRate}`);
	}
	return (60 / bpm) * sampleRate;
}

/** Convert a tick position to a sample position at a single constant tempo. */
export function ticksToSamples(ticks: number, bpm: number, sampleRate: number, ppq: number = DEFAULT_PPQ): number {
	return (ticks / ppq) * samplesPerQuarter(bpm, sampleRate);
}

/** Convert a sample position to a tick position at a single constant tempo. */
export function samplesToTicks(samples: number, bpm: number, sampleRate: number, ppq: number = DEFAULT_PPQ): number {
	return (samples / samplesPerQuarter(bpm, sampleRate)) * ppq;
}

/**
 * A piecewise-constant tempo map. Tempo holds at each point's bpm until the next point's tick.
 * This is the minimal real model; ramped/curved tempo segments are a documented later extension that must
 * not require a schema break (see specification.md §27).
 */
export class TempoMap {
	private readonly points: ReadonlyArray<TempoPoint>;
	readonly ppq: number;

	constructor(points: ReadonlyArray<TempoPoint> = [{ tick: 0, bpm: 120 }], ppq: number = DEFAULT_PPQ) {
		this.ppq = ppq;
		const sorted = [...points].sort((a, b) => a.tick - b.tick);
		// Guarantee a tempo is defined from tick 0.
		if (sorted.length === 0) {
			this.points = [{ tick: 0, bpm: 120 }];
		} else if (sorted[0].tick !== 0) {
			this.points = [{ tick: 0, bpm: sorted[0].bpm }, ...sorted];
		} else {
			this.points = sorted;
		}
	}

	/** The active tempo (bpm) at a given tick. */
	bpmAt(tick: number): number {
		let bpm = this.points[0].bpm;
		for (const point of this.points) {
			if (point.tick <= tick) {
				bpm = point.bpm;
			} else {
				break;
			}
		}
		return bpm;
	}

	/** Convert a tick position to a sample position, summing across piecewise-constant tempo segments. */
	ticksToSamples(tick: number, sampleRate: number): number {
		if (tick <= 0) {
			return 0;
		}
		let samples = 0;
		for (let index = 0; index < this.points.length; index += 1) {
			const segmentStart = this.points[index].tick;
			if (segmentStart >= tick) {
				break;
			}
			const segmentEnd = index + 1 < this.points.length ? Math.min(this.points[index + 1].tick, tick) : tick;
			samples += ticksToSamples(segmentEnd - segmentStart, this.points[index].bpm, sampleRate, this.ppq);
		}
		return samples;
	}
}
